import { ValidationError, NotFoundError, ConflictError } from "../core/service.js";
import { PrStatus, TERMINAL_PR_STATUSES, ALL_PR_STATUSES, TERMINAL_RFQ_STATUSES } from "./status.js";
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

  const { vendors, purchaseRequests, rfq, vendorResponses, statusLog } = repos;

  const emit = (event, data) => events.emit(event, data);

  const mustExistPr = (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("purchase request id is required");
    }
    const pr = purchaseRequests.getById(id);
    if (!pr) throw new NotFoundError(id);
    return pr;
  };

  const mustExistVendor = (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("vendor id is required");
    }
    const vendor = vendors.getById(id);
    if (!vendor) throw new NotFoundError(id);
    return vendor;
  };

  const transitionPr = (id, fromStatus, toStatus, extra = {}) => {
    const updated = purchaseRequests.transition(id, fromStatus, toStatus, extra);
    if (!updated) {
      throw new ConflictError(
        `purchase request ${id} could not transition from ${fromStatus} to ${toStatus}`
      );
    }
    statusLog.insert(id, fromStatus, toStatus, extra.changedBy ?? null, extra.reason ?? null);
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
        pr = purchaseRequests.insertWithItems(
          cleanTitle, cleanRequestedBy, cleanDeadline, cleanNotes, cleanItems
        );
      } else {
        pr = purchaseRequests.insert(cleanTitle, cleanRequestedBy, cleanDeadline, cleanNotes);
        pr.lineItems = [];
      }

      statusLog.insert(pr.id, null, PrStatus.DRAFT, cleanRequestedBy, null);
      await emit(ProcurementEvents.PR_CREATED, pr);
      return pr;
    },

    getPr(id) {
      const pr = mustExistPr(id);
      pr.shortlist = purchaseRequests.getShortlist(id);
      pr.rfqEmails = rfq.listByPr(id);
      return pr;
    },

    listPrs({ status, search, limit } = {}) {
      if (status && !ALL_PR_STATUSES.has(status)) {
        throw new ValidationError(`invalid status: ${status}`);
      }
      return purchaseRequests.listAll(
        status ?? null,
        search ?? null,
        clampLimit(limit, 100, 500)
      );
    },

    async updateDraft(id, patch) {
      const pr = mustExistPr(id);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${id} is ${pr.status}, can only edit drafts`);
      }
      const cleanPatch = {};
      if (patch.title != null) cleanPatch.title = requireString(patch.title, "title", MAX_TITLE_LEN);
      if (patch.notes != null) cleanPatch.notes = optionalString(patch.notes, "notes", MAX_NOTES_LEN);
      if (patch.deadline != null) cleanPatch.deadline = Number(patch.deadline);

      const updated = purchaseRequests.updateDraft(id, cleanPatch);
      if (!updated) throw new ConflictError(`PR ${id} could not be updated`);
      return updated;
    },

    async addLineItem(prId, item) {
      const pr = mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only add items to drafts`);
      }
      const clean = validateLineItem(item);
      return purchaseRequests.addLineItem(prId, clean);
    },

    async updateLineItem(prId, itemId, patch) {
      const pr = mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only edit items in drafts`);
      }
      return purchaseRequests.updateLineItem(prId, itemId, patch);
    },

    async removeLineItem(prId, itemId) {
      const pr = mustExistPr(prId);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${prId} is ${pr.status}, can only remove items from drafts`);
      }
      const ok = purchaseRequests.removeLineItem(prId, itemId);
      if (!ok) throw new NotFoundError(`line item ${itemId}`);
      return { deleted: true };
    },

    async submitForApproval(id) {
      const pr = mustExistPr(id);
      if (pr.status !== PrStatus.DRAFT) {
        throw new ConflictError(`PR ${id} is ${pr.status}, must be draft to submit`);
      }
      if (!pr.lineItems || pr.lineItems.length === 0) {
        throw new ValidationError("cannot submit PR with no line items");
      }
      const updated = transitionPr(id, PrStatus.DRAFT, PrStatus.PENDING_APPROVAL);
      await emit(ProcurementEvents.PR_SUBMITTED, updated);
      return updated;
    },

    async approve(id, approvedBy) {
      mustExistPr(id);
      const cleanApprover = requireString(approvedBy, "approved_by", 200);
      const updated = transitionPr(id, PrStatus.PENDING_APPROVAL, PrStatus.APPROVED, {
        approvedBy: cleanApprover,
        changedBy: cleanApprover,
      });
      await emit(ProcurementEvents.PR_APPROVED, updated);
      return updated;
    },

    async reject(id, reason) {
      mustExistPr(id);
      const cleanReason = requireString(reason, "reason", MAX_REASON_LEN);
      const updated = transitionPr(id, PrStatus.PENDING_APPROVAL, PrStatus.REJECTED, {
        rejectedReason: cleanReason,
        reason: cleanReason,
      });
      await emit(ProcurementEvents.PR_REJECTED, updated);
      return updated;
    },

    async startSourcing(id) {
      const pr = mustExistPr(id);
      if (pr.status !== PrStatus.APPROVED) {
        throw new ConflictError(`PR ${id} is ${pr.status}, must be approved to start sourcing`);
      }

      // Create a sourcing task via the existing task service
      let task = null;
      if (taskService) {
        const lineItems = pr.lineItems || purchaseRequests.getLineItems(id);
        const itemSummary = lineItems
          .map((i) => `${i.quantity} ${i.unit} of ${i.materialName}`)
          .join(", ");
        const prompt =
          `Sourcing task for PR "${pr.title}" (${id}).\n` +
          `Find vendors for: ${itemSummary}.\n` +
          `Use search_vendors to find suitable vendors, then submit_vendor_shortlist ` +
          `with your recommendations.`;
        task = await taskService.create(prompt);
      }

      const updated = transitionPr(id, PrStatus.APPROVED, PrStatus.PENDING_SOURCING, {
        sourcingTaskId: task?.id ?? null,
        changedBy: "system",
      });
      await emit(ProcurementEvents.PR_SOURCING_STARTED, { ...updated, task });
      return { pr: updated, task };
    },

    async submitShortlist(prId, shortlist) {
      const pr = mustExistPr(prId);
      // Allow submission during sourcing or pending_sourcing (agent may submit before system transitions)
      if (pr.status !== PrStatus.SOURCING && pr.status !== PrStatus.PENDING_SOURCING) {
        throw new ConflictError(
          `PR ${prId} is ${pr.status}, must be in sourcing or pending_sourcing to submit shortlist`
        );
      }
      if (!Array.isArray(shortlist) || shortlist.length === 0) {
        throw new ValidationError("shortlist must be a non-empty array");
      }
      // Validate each entry has a vendorId
      for (const entry of shortlist) {
        if (!entry.vendorId) throw new ValidationError("each shortlist entry must have vendorId");
        mustExistVendor(entry.vendorId);
      }

      const entries = purchaseRequests.insertShortlist(prId, shortlist);
      const fromStatus = pr.status;
      const updated = transitionPr(prId, fromStatus, PrStatus.SOURCED, {
        changedBy: "agent",
      });
      await emit(ProcurementEvents.PR_SOURCED, { ...updated, shortlist: entries });
      return { pr: updated, shortlist: entries };
    },

    async cancel(id, reason) {
      const pr = mustExistPr(id);
      if (TERMINAL_PR_STATUSES.has(pr.status)) {
        throw new ConflictError(`PR ${id} is ${pr.status}, cannot cancel a terminal PR`);
      }
      const cleanReason = optionalString(reason, "reason", MAX_REASON_LEN);
      const updated = transitionPr(id, pr.status, PrStatus.CANCELLED, {
        changedBy: "user",
        reason: cleanReason,
      });
      await emit(ProcurementEvents.PR_CANCELLED, updated);
      return updated;
    },

    /* ──── RFQ Management ──── */

    async createRfqEmails(prId, rfqPlan) {
      mustExistPr(prId);
      if (!Array.isArray(rfqPlan) || rfqPlan.length === 0) {
        throw new ValidationError("rfqPlan must be a non-empty array");
      }
      const created = [];
      for (const plan of rfqPlan) {
        if (!plan.vendorId || !plan.toEmail) {
          throw new ValidationError("each rfqPlan entry must have vendorId and toEmail");
        }
        const rfqEmail = rfq.insert({
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

    async updateRfqStatus(rfqId, status, metadata = {}) {
      const existing = rfq.getById(rfqId);
      if (!existing) throw new NotFoundError(rfqId);
      const updated = rfq.updateStatus(rfqId, status, metadata);
      await emit(ProcurementEvents.RFQ_STATUS_UPDATED, updated);
      return updated;
    },

    async recordVendorResponse(rfqId, data) {
      const rfqEmail = rfq.getById(rfqId);
      if (!rfqEmail) throw new NotFoundError(rfqId);
      const response = vendorResponses.insert({
        rfqId,
        prId: rfqEmail.prId,
        vendorId: rfqEmail.vendorId,
        ...data,
      });
      await emit(ProcurementEvents.VENDOR_RESPONSE_RECEIVED, response);
      return response;
    },

    async checkPrCompletion(prId) {
      const pr = mustExistPr(prId);
      const rfqEmails = rfq.listByPr(prId);
      if (rfqEmails.length === 0) return pr;

      const allTerminal = rfqEmails.every((r) => TERMINAL_RFQ_STATUSES.has(r.status));
      if (!allTerminal) return pr;

      // If all RFQs are terminal, transition PR to quotes_received
      if (pr.status === PrStatus.AWAITING_REPLIES || pr.status === PrStatus.RFQ_SENT) {
        const updated = transitionPr(prId, pr.status, PrStatus.QUOTES_RECEIVED, {
          changedBy: "system",
        });
        await emit(ProcurementEvents.PR_QUOTES_RECEIVED, updated);
        return updated;
      }
      return pr;
    },

    /* ──── Queries ──── */

    getTimeline(prId) {
      mustExistPr(prId);
      return statusLog.listByPr(prId);
    },

    getComparison(prId) {
      const pr = mustExistPr(prId);
      const responses = vendorResponses.listByPr(prId);
      const lineItems = pr.lineItems || [];
      const rfqEmails = rfq.listByPr(prId);

      // Build a matrix: lineItem x vendor
      const matrix = lineItems.map((item) => {
        const quotes = responses
          .filter((r) => r.lineItemId === item.id)
          .map((r) => {
            const rfqEmail = rfqEmails.find((e) => e.id === r.rfqId);
            const vendor = vendors.getById(r.vendorId);
            return {
              vendorId: r.vendorId,
              vendorName: vendor?.name ?? "Unknown",
              vendorEmail: rfqEmail?.toEmail ?? null,
              unitPrice: r.unitPrice,
              totalPrice: r.totalPrice,
              leadTimeDays: r.leadTimeDays,
              currency: r.currency,
              availability: r.availability,
            };
          });
        return {
          lineItemId: item.id,
          materialName: item.materialName,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit,
          quotes,
        };
      });

      return { prId, matrix };
    },

    /* ──── Vendor Management (delegated to repo) ──── */

    createVendor(data) {
      if (!data.name) throw new ValidationError("vendor name is required");
      if (!data.email) throw new ValidationError("vendor email is required");
      return vendors.insert(data);
    },

    getVendor(id) {
      const vendor = mustExistVendor(id);
      vendor.materials = vendors.listMaterials(id);
      return vendor;
    },

    listVendors(opts) {
      return vendors.listAll(opts);
    },

    updateVendor(id, patch) {
      mustExistVendor(id);
      return vendors.update(id, patch);
    },

    deactivateVendor(id) {
      mustExistVendor(id);
      return vendors.deactivate(id);
    },

    activateVendor(id) {
      mustExistVendor(id);
      return vendors.activate(id);
    },

    addVendorMaterial(vendorId, material) {
      mustExistVendor(vendorId);
      if (!material.materialName) throw new ValidationError("material_name is required");
      return vendors.insertMaterial(vendorId, material);
    },

    updateVendorMaterial(vendorId, materialId, patch) {
      mustExistVendor(vendorId);
      const existing = vendors.getMaterialById(vendorId, materialId);
      if (!existing) throw new NotFoundError(`material ${materialId}`);
      return vendors.updateMaterial(vendorId, materialId, patch);
    },

    deleteVendorMaterial(vendorId, materialId) {
      mustExistVendor(vendorId);
      const ok = vendors.deleteMaterial(vendorId, materialId);
      if (!ok) throw new NotFoundError(`material ${materialId}`);
      return { deleted: true };
    },

    listVendorMaterials(vendorId) {
      mustExistVendor(vendorId);
      return vendors.listMaterials(vendorId);
    },

    searchVendors(query, category, limit) {
      return vendors.searchByMaterial(query, category, clampLimit(limit, 20, 100));
    },

    getPurchaseHistory({ materialName, vendorId, limit } = {}) {
      return purchaseRequests.getCompletedHistory({
        materialName: materialName ?? null,
        vendorId: vendorId ?? null,
        limit: clampLimit(limit, 50, 500),
      });
    },

    getVendorKpis(vendorId) {
      mustExistVendor(vendorId);
      const kpis = vendors.getKpis(vendorId);

      // Compute winRate and priceCompetitiveness from vendor_responses
      const myResponses = vendorResponses.listByVendor(vendorId);

      let wins = 0;
      let comparisons = 0;
      let percentileSum = 0;
      let percentileCount = 0;

      for (const mine of myResponses) {
        if (mine.unitPrice == null || mine.lineItemId == null) continue;

        const competitors = vendorResponses.listCompetitorsForLineItem(mine.prId, mine.lineItemId);
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

    importVendors(vendorList) {
      if (!Array.isArray(vendorList) || vendorList.length === 0) {
        throw new ValidationError("vendor list must be a non-empty array");
      }
      const results = [];
      for (const v of vendorList) {
        if (!v.name) throw new ValidationError("each vendor must have a name");
        if (!v.email) throw new ValidationError("each vendor must have an email");
        const vendor = vendors.insert(v);
        if (v.materials && Array.isArray(v.materials)) {
          for (const m of v.materials) {
            vendors.insertMaterial(vendor.id, m);
          }
        }
        results.push(vendor);
      }
      return results;
    },
  };
};
