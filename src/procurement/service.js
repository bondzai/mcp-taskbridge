import { ValidationError, NotFoundError, ConflictError } from "../core/service.js";
import { PrStatus, ItemStatus, TERMINAL_PR_STATUSES, ALL_PR_STATUSES, TERMINAL_RFQ_STATUSES, ITEM_TERMINAL } from "./status.js";
import { ProcurementEvents } from "./events.js";

const MAX_TITLE_LEN = 500;
const MAX_NOTES_LEN = 4_000;
const MAX_REASON_LEN = 2_000;
const MAX_MATERIAL_LEN = 200;
const MAX_SPEC_LEN = 500;
const MAX_UNIT_LEN = 50;

const requireString = (value, field, max) => {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === "") throw new ValidationError(`${field} must be non-empty`);
  if (trimmed.length > max) throw new ValidationError(`${field} exceeds ${max} chars`);
  return trimmed;
};

const optionalString = (value, field, max) => {
  if (value == null) return null;
  return requireString(value, field, max);
};

const requirePositiveNumber = (value, field) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive number`);
  }
  return value;
};

const clampLimit = (limit, fallback, max) => {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

export const createProcurementService = ({ repos, events, taskService }) => {
  if (!repos) throw new Error("repos is required");
  if (!events) throw new Error("events bus is required");

  const { vendors, purchaseRequests, rfq, vendorResponses, statusLog, itemStatusLog } = repos;

  const emit = (event, data) => events.emit(event, data);

  // RFQ payloads ready for email service (stored until Pub/Sub is wired)
  const rfqPayloadStore = new Map();

  const mustExistPr = async (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("purchase request id is required");
    }
    const pr = await purchaseRequests.getById(id);
    if (!pr) throw new NotFoundError(id);
    return pr;
  };

  const mustExistVendor = async (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("vendor id is required");
    }
    const vendor = await vendors.getById(id);
    if (!vendor) throw new NotFoundError(id);
    return vendor;
  };

  const transitionPr = async (id, fromStatus, toStatus, extra = {}) => {
    const updated = await purchaseRequests.transition(id, fromStatus, toStatus, extra);
    if (!updated) {
      throw new ConflictError(
        `purchase request ${id} could not transition from ${fromStatus} to ${toStatus}`
      );
    }
    await statusLog.insert(id, fromStatus, toStatus, extra.changedBy ?? null, extra.reason ?? null);
    return updated;
  };

  const validateLineItem = (item) => {
    const materialName = requireString(item.materialName, "material_name", MAX_MATERIAL_LEN);
    const specification = optionalString(item.specification, "specification", MAX_SPEC_LEN);
    const quantity = requirePositiveNumber(item.quantity, "quantity");
    const unit = requireString(item.unit, "unit", MAX_UNIT_LEN);
    const notes = optionalString(item.notes, "notes", MAX_NOTES_LEN);
    return { materialName, specification, quantity, unit, notes };
  };

  const VALID_ITEM_TRANSITIONS = {
    [ItemStatus.DRAFT]: new Set([ItemStatus.SOURCING, ItemStatus.CANCELLED]),
    [ItemStatus.SOURCING]: new Set([ItemStatus.QUOTED, ItemStatus.CANCELLED]),
    [ItemStatus.QUOTED]: new Set([ItemStatus.SELECTED, ItemStatus.CANCELLED]),
    [ItemStatus.SELECTED]: new Set([ItemStatus.ORDERED, ItemStatus.CANCELLED]),
    [ItemStatus.ORDERED]: new Set([ItemStatus.RECEIVED, ItemStatus.CANCELLED]),
    [ItemStatus.RECEIVED]: new Set(),
    [ItemStatus.CANCELLED]: new Set(),
  };

  const recomputePrStatus = async (prId) => {
    const pr = await purchaseRequests.getById(prId);
    if (!pr || ["draft", "pending_approval", "cancelled", "completed"].includes(pr.status)) return pr;
    const items = await purchaseRequests.getLineItems(prId);
    const active = items.filter(i => i.status !== "cancelled");
    if (active.length === 0) return transitionPr(prId, pr.status, "cancelled");
    let newStatus = pr.status;
    if (active.every(i => ["received"].includes(i.status))) newStatus = "completed";
    else if (active.some(i => ["sourcing", "quoted", "selected", "ordered"].includes(i.status))) newStatus = "processing";
    else if (active.every(i => i.status === "draft")) newStatus = "pending";
    if (newStatus !== pr.status) return transitionPr(prId, pr.status, newStatus);
    return pr;
  };

  return {
    /* ──── PR Lifecycle ──── */

    async createPr(title, requestedBy, { deadline, notes, lineItems } = {}) {
      const cleanTitle = requireString(title, "title", MAX_TITLE_LEN);
      const cleanRequestedBy = optionalString(requestedBy, "requested_by", 200);
      const cleanNotes = optionalString(notes, "notes", MAX_NOTES_LEN);
      const cleanDeadline = deadline != null ? Number(deadline) : null;

      const cleanItems = (lineItems || []).map(validateLineItem);

      let pr;
      if (cleanItems.length > 0) {
        pr = await purchaseRequests.insertWithItems(
          cleanTitle, cleanRequestedBy, cleanDeadline, cleanNotes, cleanItems
        );
      } else {
        pr = await purchaseRequests.insert(cleanTitle, cleanRequestedBy, cleanDeadline, cleanNotes);
        pr.lineItems = [];
      }

      await statusLog.insert(pr.id, null, PrStatus.DRAFT, cleanRequestedBy, null);
      await emit(ProcurementEvents.PR_CREATED, pr);
      return pr;
    },

    async getPr(id) {
      const pr = await mustExistPr(id);
      pr.shortlist = await purchaseRequests.getShortlist(id);
      pr.rfqEmails = await rfq.listByPr(id);
      return pr;
    },

    async listPrs({ status, search, limit } = {}) {
      if (status && !ALL_PR_STATUSES.has(status)) {
        throw new ValidationError(`invalid status: ${status}`);
      }
      return await purchaseRequests.listAll(
        status ?? null,
        search ?? null,
        clampLimit(limit, 100, 500)
      );
    },

    async updateDraft(id, patch) {
      const pr = await mustExistPr(id);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${id} is ${pr.status}, can only edit drafts`);
      }
      const cleanPatch = {};
      if (patch.title != null) cleanPatch.title = requireString(patch.title, "title", MAX_TITLE_LEN);
      if (patch.notes != null) cleanPatch.notes = optionalString(patch.notes, "notes", MAX_NOTES_LEN);
      if (patch.deadline != null) cleanPatch.deadline = Number(patch.deadline);

      const updated = await purchaseRequests.updateDraft(id, cleanPatch);
      if (!updated) throw new ConflictError(`PR ${id} could not be updated`);
      return updated;
    },

    async addLineItem(prId, item) {
      const pr = await mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only add items to drafts`);
      }
      const clean = validateLineItem(item);
      return await purchaseRequests.addLineItem(prId, clean);
    },

    async updateLineItem(prId, itemId, patch) {
      const pr = await mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only edit items in drafts`);
      }
      return await purchaseRequests.updateLineItem(prId, itemId, patch);
    },

    async removeLineItem(prId, itemId) {
      const pr = await mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only remove items from drafts`);
      }
      const ok = await purchaseRequests.removeLineItem(prId, itemId);
      if (!ok) throw new NotFoundError(`line item ${itemId}`);
      return { deleted: true };
    },

    async submitForApproval(id) {
      const pr = await mustExistPr(id);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${id} is ${pr.status}, must be draft to submit`);
      }
      if (!pr.lineItems || pr.lineItems.length === 0) {
        throw new ValidationError("cannot submit PR with no line items");
      }
      const updated = await transitionPr(id, PrStatus.DRAFT, PrStatus.PENDING_APPROVAL);
      await emit(ProcurementEvents.PR_SUBMITTED, updated);
      return updated;
    },

    async approve(id, approvedBy) {
      await mustExistPr(id);
      const cleanApprover = requireString(approvedBy, "approved_by", 200);
      const updated = await transitionPr(id, PrStatus.PENDING_APPROVAL, PrStatus.PENDING, {
        approvedBy: cleanApprover,
        changedBy: cleanApprover,
      });
      await emit(ProcurementEvents.PR_APPROVED, updated);
      // Create sourcing task so agent can pick it up from queue
      await this.startSourcing(id);
      // Return the PR in "approved" state — it moves to "processing"
      // only when the agent claims the task
      return mustExistPr(id);
    },

    async reject(id, reason) {
      await mustExistPr(id);
      const cleanReason = requireString(reason, "reason", MAX_REASON_LEN);
      const updated = await transitionPr(id, PrStatus.PENDING_APPROVAL, PrStatus.CANCELLED, {
        rejectedReason: cleanReason,
        reason: `Rejected: ${cleanReason}`,
      });
      await emit(ProcurementEvents.PR_CANCELLED, updated);
      return updated;
    },

    async startSourcing(id) {
      const pr = await mustExistPr(id);
      if (pr.status !== PrStatus.PENDING) {
        throw new ConflictError(`PR ${id} is ${pr.status}, must be approved to start sourcing`);
      }

      let task = null;
      if (taskService) {
        const lineItems = pr.lineItems || await purchaseRequests.getLineItems(id);
        const itemSummary = lineItems
          .map((i) => `${i.quantity} ${i.unit} of ${i.materialName}`)
          .join(", ");
        const prompt =
          `Sourcing task for PR "${pr.title}" (${id}).\n` +
          `Find vendors for: ${itemSummary}.\n` +
          `Use search_vendors, get_purchase_request, and get_vendor_details to find suitable vendors.\n` +
          `Call report_progress after each step.\n` +
          `Then call submit_vendor_shortlist with your recommendations.`;
        task = await taskService.create(prompt, { type: "sourcing", prId: id });
      }

      // Stay "approved" — PR is now in the sourcing queue.
      // Moves to "processing" when the agent claims the task.
      await purchaseRequests.transition(id, PrStatus.PENDING, PrStatus.PENDING, { sourcingTaskId: task?.id ?? null });
      await statusLog.insert(id, PrStatus.PENDING, PrStatus.PENDING, "system", "Sourcing task queued");

      await emit(ProcurementEvents.PR_SOURCING_STARTED, { ...pr, sourcingTaskId: task?.id ?? null, task });
      return { pr: await mustExistPr(id), task };
    },

    async onTaskClaimed(prId) {
      const pr = await mustExistPr(prId);
      if (pr.status !== PrStatus.PENDING) return pr;

      const updated = await transitionPr(prId, PrStatus.PENDING, PrStatus.PROCESSING, {
        changedBy: "agent",
      });

      const lineItems = await purchaseRequests.getLineItems(prId);
      for (const item of lineItems) {
        if (item.status === ItemStatus.DRAFT) {
          await purchaseRequests.updateItemStatus(prId, item.id, ItemStatus.SOURCING, {});
          if (itemStatusLog) {
            await itemStatusLog.insert(item.id, prId, ItemStatus.DRAFT, ItemStatus.SOURCING, "agent", "Agent claimed sourcing task");
          }
        }
      }

      await emit(ProcurementEvents.PR_SOURCING_STARTED, updated);
      return updated;
    },

    async submitShortlist(prId, shortlist) {
      const pr = await mustExistPr(prId);
      // Allow submission during processing or approved (agent may submit before system transitions)
      if (pr.status !== PrStatus.PROCESSING && pr.status !== PrStatus.PENDING) {
        throw new ConflictError(
          `PR ${prId} is ${pr.status}, must be in processing or approved to submit shortlist`
        );
      }
      if (!Array.isArray(shortlist) || shortlist.length === 0) {
        throw new ValidationError("shortlist must be a non-empty array");
      }
      // Validate each entry has a vendorId
      for (const entry of shortlist) {
        if (!entry.vendorId) throw new ValidationError("each shortlist entry must have vendorId");
        await mustExistVendor(entry.vendorId);
      }

      const entries = await purchaseRequests.insertShortlist(prId, shortlist);

      // Transition shortlisted items to "quoted"
      const lineItems = await purchaseRequests.getLineItems(prId);
      for (const entry of shortlist) {
        if (entry.lineItemId) {
          const item = lineItems.find(i => i.id === entry.lineItemId);
          if (item && item.status !== ItemStatus.QUOTED && item.status !== ItemStatus.CANCELLED) {
            await purchaseRequests.updateItemStatus(prId, item.id, ItemStatus.QUOTED, {
              selectedVendorId: entry.vendorId ?? null,
              selectedPrice: entry.referencePrice ?? null,
            });
            if (itemStatusLog) {
              await itemStatusLog.insert(item.id, prId, item.status, ItemStatus.QUOTED, "agent", entry.notes ?? null);
            }
          }
        }
      }

      // Recompute PR status based on item states
      const updatedPr = (await recomputePrStatus(prId)) || pr;
      await emit(ProcurementEvents.PR_SOURCED, { ...updatedPr, shortlist: entries });
      return { pr: updatedPr, shortlist: entries };
    },

    async cancel(id, reason) {
      const pr = await mustExistPr(id);
      if (TERMINAL_PR_STATUSES.has(pr.status)) {
        throw new ConflictError(`PR ${id} is ${pr.status}, cannot cancel a terminal PR`);
      }
      const cleanReason = optionalString(reason, "reason", MAX_REASON_LEN);
      const updated = await transitionPr(id, pr.status, PrStatus.CANCELLED, {
        changedBy: "user",
        reason: cleanReason,
      });
      await emit(ProcurementEvents.PR_CANCELLED, updated);
      return updated;
    },

    async duplicatePr(id) {
      const source = await mustExistPr(id);
      const items = source.lineItems || await purchaseRequests.getLineItems(id);
      const cleanItems = items.map(i => ({
        materialName: i.materialName,
        specification: i.specification,
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes,
      }));
      let pr;
      if (cleanItems.length > 0) {
        pr = await purchaseRequests.insertWithItems(`${source.title} (copy)`, source.requestedBy, source.deadline, source.notes, cleanItems);
      } else {
        pr = await purchaseRequests.insert(`${source.title} (copy)`, source.requestedBy, source.deadline, source.notes);
        pr.lineItems = [];
      }
      await statusLog.insert(pr.id, null, PrStatus.DRAFT, "system", `Duplicated from PR ${id}`);
      await emit(ProcurementEvents.PR_CREATED, pr);
      return pr;
    },

    async reprocessPr(id) {
      const pr = await mustExistPr(id);
      if (pr.status === PrStatus.DRAFT || pr.status === PrStatus.PENDING_APPROVAL) {
        throw new ConflictError(`PR ${id} is ${pr.status}, nothing to reprocess`);
      }
      const items = pr.lineItems || await purchaseRequests.getLineItems(id);
      for (const item of items) {
        if (item.status !== "cancelled") {
          await purchaseRequests.updateItemStatus(id, item.id, "draft", {});
          if (itemStatusLog) {
            await itemStatusLog.insert(item.id, id, item.status, "draft", "system", "Reprocessing PR");
          }
        }
      }
      const updated = await transitionPr(id, pr.status, PrStatus.PENDING, {
        changedBy: "system",
        reason: "Reprocessing — reset for re-sourcing",
      });
      await this.startSourcing(id);
      await emit(ProcurementEvents.PR_SOURCING_STARTED, updated);
      return await mustExistPr(id);
    },

    /* ──── Item Status ──── */

    async updateItemStatus(prId, itemId, newStatus, { changedBy, note, selectedVendorId, selectedPrice, poNumber } = {}) {
      const pr = await mustExistPr(prId);
      const item = await purchaseRequests.getLineItem(prId, itemId);
      if (!item) throw new NotFoundError(`line item ${itemId} in PR ${prId}`);

      // Validate newStatus is a valid ItemStatus value
      const allItemStatuses = new Set(Object.values(ItemStatus));
      if (!allItemStatuses.has(newStatus)) {
        throw new ValidationError(`invalid item status: ${newStatus}`);
      }

      // Validate transition
      const allowed = VALID_ITEM_TRANSITIONS[item.status];
      if (!allowed || !allowed.has(newStatus)) {
        throw new ConflictError(
          `item ${itemId} cannot transition from ${item.status} to ${newStatus}`
        );
      }

      const updated = await purchaseRequests.updateItemStatus(prId, itemId, newStatus, {
        selectedVendorId: selectedVendorId ?? null,
        selectedPrice: selectedPrice ?? null,
        poNumber: poNumber ?? null,
        note: note ?? null,
      });

      if (itemStatusLog) {
        await itemStatusLog.insert(itemId, prId, item.status, newStatus, changedBy ?? null, note ?? null);
      }

      const updatedPr = await recomputePrStatus(prId);
      await emit(ProcurementEvents.ITEM_STATUS_CHANGED, {
        prId,
        itemId,
        fromStatus: item.status,
        toStatus: newStatus,
        pr: updatedPr,
      });

      return { item: updated, pr: updatedPr };
    },

    async getItemTimeline(prId, itemId) {
      await mustExistPr(prId);
      const item = await purchaseRequests.getLineItem(prId, itemId);
      if (!item) throw new NotFoundError(`line item ${itemId} in PR ${prId}`);
      if (!itemStatusLog) return [];
      return await itemStatusLog.listByItem(itemId);
    },

    /* ──── RFQ Management ──── */

    async createRfqEmails(prId, rfqPlan) {
      await mustExistPr(prId);
      if (!Array.isArray(rfqPlan) || rfqPlan.length === 0) {
        throw new ValidationError("rfqPlan must be a non-empty array");
      }
      const created = [];
      for (const plan of rfqPlan) {
        if (!plan.vendorId || !plan.toEmail) {
          throw new ValidationError("each rfqPlan entry must have vendorId and toEmail");
        }
        const rfqEmail = await rfq.insert({
          prId,
          vendorId: plan.vendorId,
          toEmail: plan.toEmail,
          lineItemIds: plan.lineItemIds ?? null,
        });
        created.push(rfqEmail);
      }
      await emit(ProcurementEvents.RFQ_CREATED, { prId, rfqEmails: created });
      return created;
    },

    async storeRfqPayloads(prId, payloads) {
      rfqPayloadStore.set(prId, { payloads, createdAt: Date.now() });
    },

    getRfqPayloads(prId) {
      return rfqPayloadStore.get(prId) || null;
    },

    async updateRfqStatus(rfqId, status, metadata = {}) {
      const existing = await rfq.getById(rfqId);
      if (!existing) throw new NotFoundError(rfqId);
      const updated = await rfq.updateStatus(rfqId, status, metadata);
      await emit(ProcurementEvents.RFQ_STATUS_UPDATED, updated);
      return updated;
    },

    async recordVendorResponse(rfqId, data) {
      const rfqEmail = await rfq.getById(rfqId);
      if (!rfqEmail) throw new NotFoundError(rfqId);
      const response = await vendorResponses.insert({
        rfqId,
        prId: rfqEmail.prId,
        vendorId: rfqEmail.vendorId,
        ...data,
      });
      await emit(ProcurementEvents.VENDOR_RESPONSE_RECEIVED, response);
      return response;
    },

    async checkPrCompletion(prId) {
      const pr = await mustExistPr(prId);
      const rfqEmails = await rfq.listByPr(prId);
      if (rfqEmails.length === 0) return pr;

      const allTerminal = rfqEmails.every((r) => TERMINAL_RFQ_STATUSES.has(r.status));
      if (!allTerminal) return pr;

      // If all RFQs are terminal, recompute PR status from item states
      if (pr.status === PrStatus.PROCESSING) {
        const updated = await recomputePrStatus(prId);
        return updated || pr;
      }
      return pr;
    },

    /* ──── Queries ──── */

    async getTimeline(prId) {
      await mustExistPr(prId);
      return await statusLog.listByPr(prId);
    },

    async getComparison(prId) {
      const pr = await mustExistPr(prId);
      const responses = await vendorResponses.listByPr(prId);
      const lineItems = pr.lineItems || [];
      const rfqEmails = await rfq.listByPr(prId);

      // Build a matrix: lineItem x vendor
      const matrix = [];
      for (const item of lineItems) {
        const quotes = [];
        for (const r of responses.filter((r) => r.lineItemId === item.id)) {
          const rfqEmail = rfqEmails.find((e) => e.id === r.rfqId);
          const vendor = await vendors.getById(r.vendorId);
          quotes.push({
            vendorId: r.vendorId,
            vendorName: vendor?.name ?? "Unknown",
            vendorEmail: rfqEmail?.toEmail ?? null,
            unitPrice: r.unitPrice,
            totalPrice: r.totalPrice,
            leadTimeDays: r.leadTimeDays,
            currency: r.currency,
            availability: r.availability,
          });
        }
        matrix.push({
          lineItemId: item.id,
          materialName: item.materialName,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit,
          quotes,
        });
      }

      return { prId, matrix };
    },

    /* ──── Vendor Management (delegated to repo) ──── */

    async createVendor(data) {
      if (!data.name) throw new ValidationError("vendor name is required");
      if (!data.email) throw new ValidationError("vendor email is required");
      return await vendors.insert(data);
    },

    async getVendor(id) {
      const vendor = await mustExistVendor(id);
      vendor.materials = await vendors.listMaterials(id);
      return vendor;
    },

    async listVendors(opts) {
      return await vendors.listAll(opts);
    },

    async updateVendor(id, patch) {
      await mustExistVendor(id);
      return await vendors.update(id, patch);
    },

    async deactivateVendor(id) {
      await mustExistVendor(id);
      return await vendors.deactivate(id);
    },

    async activateVendor(id) {
      await mustExistVendor(id);
      return await vendors.activate(id);
    },

    async addVendorMaterial(vendorId, material) {
      await mustExistVendor(vendorId);
      if (!material.materialName) throw new ValidationError("material_name is required");
      return await vendors.insertMaterial(vendorId, material);
    },

    async updateVendorMaterial(vendorId, materialId, patch) {
      await mustExistVendor(vendorId);
      const existing = await vendors.getMaterialById(vendorId, materialId);
      if (!existing) throw new NotFoundError(`material ${materialId}`);
      return await vendors.updateMaterial(vendorId, materialId, patch);
    },

    async deleteVendorMaterial(vendorId, materialId) {
      await mustExistVendor(vendorId);
      const ok = await vendors.deleteMaterial(vendorId, materialId);
      if (!ok) throw new NotFoundError(`material ${materialId}`);
      return { deleted: true };
    },

    async listVendorMaterials(vendorId) {
      await mustExistVendor(vendorId);
      return await vendors.listMaterials(vendorId);
    },

    async searchVendors(query, category, limit) {
      return await vendors.searchByMaterial(query, category, clampLimit(limit, 20, 100));
    },

    async getPurchaseHistory({ materialName, vendorId, limit } = {}) {
      return await purchaseRequests.getCompletedHistory({
        materialName: materialName ?? null,
        vendorId: vendorId ?? null,
        limit: clampLimit(limit, 50, 500),
      });
    },

    async getVendorKpis(vendorId) {
      await mustExistVendor(vendorId);
      const kpis = await vendors.getKpis(vendorId);

      // Compute winRate and priceCompetitiveness from vendor_responses
      const myResponses = await vendorResponses.listByVendor(vendorId);

      let wins = 0;
      let comparisons = 0;
      let percentileSum = 0;
      let percentileCount = 0;

      for (const mine of myResponses) {
        if (mine.unitPrice == null || mine.lineItemId == null) continue;

        const competitors = await vendorResponses.listCompetitorsForLineItem(mine.prId, mine.lineItemId);
        if (competitors.length === 0) continue;

        comparisons++;
        const prices = competitors.map((c) => c.unitPrice);
        const minPrice = Math.min(...prices);
        if (mine.unitPrice <= minPrice) wins++;

        // Percentile: fraction of competitors with higher price
        const cheaper = prices.filter((p) => p > mine.unitPrice).length;
        percentileSum += cheaper / prices.length;
        percentileCount++;
      }

      return {
        ...kpis,
        winRate: comparisons > 0 ? wins / comparisons : null,
        priceCompetitiveness: percentileCount > 0 ? percentileSum / percentileCount : null,
      };
    },

    async importVendors(vendorList) {
      if (!Array.isArray(vendorList) || vendorList.length === 0) {
        throw new ValidationError("vendor list must be a non-empty array");
      }
      const results = [];
      for (const v of vendorList) {
        if (!v.name) throw new ValidationError("each vendor must have a name");
        if (!v.email) throw new ValidationError("each vendor must have an email");
        const vendor = await vendors.insert(v);
        if (v.materials && Array.isArray(v.materials)) {
          for (const m of v.materials) {
            await vendors.insertMaterial(vendor.id, m);
          }
        }
        results.push(vendor);
      }
      return results;
    },
  };
};
