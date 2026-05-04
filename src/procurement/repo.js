import { randomUUID } from "node:crypto";

/* ───────────── row mappers ───────────── */

const rowToVendor = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    address: row.address ?? null,
    categories: row.categories ? JSON.parse(row.categories) : [],
    leadTimeDays: row.lead_time_days ?? null,
    currency: row.currency ?? "USD",
    notes: row.notes ?? null,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const rowToMaterial = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    materialName: row.material_name,
    category: row.category ?? null,
    unit: row.unit ?? null,
    referencePrice: row.reference_price ?? null,
    priceUpdatedAt: row.price_updated_at ?? null,
    minOrderQty: row.min_order_qty ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
};

const rowToPr = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    requestedBy: row.requested_by ?? null,
    approvedBy: row.approved_by ?? null,
    rejectedReason: row.rejected_reason ?? null,
    deadline: row.deadline ?? null,
    notes: row.notes ?? null,
    sourcingTaskId: row.sourcing_task_id ?? null,
    analysisTaskId: row.analysis_task_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const rowToLineItem = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    prId: row.pr_id,
    materialName: row.material_name,
    specification: row.specification ?? null,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes ?? null,
    status: row.status ?? "draft",
    selectedVendorId: row.selected_vendor_id ?? null,
    selectedPrice: row.selected_price ?? null,
    poNumber: row.po_number ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
};

const rowToShortlistEntry = (row) => {
  if (!row) return null;
  let rfxTypes = [];
  if (row.rfx_types) {
    try { const v = JSON.parse(row.rfx_types); if (Array.isArray(v)) rfxTypes = v; } catch {}
  }
  return {
    id: row.id,
    prId: row.pr_id,
    vendorId: row.vendor_id,
    lineItemId: row.line_item_id ?? null,
    referencePrice: row.reference_price ?? null,
    notes: row.notes ?? null,
    rfxTypes,
    createdAt: row.created_at,
  };
};

const rowToRfq = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    prId: row.pr_id,
    vendorId: row.vendor_id,
    toEmail: row.to_email,
    status: row.status,
    gmailThreadId: row.gmail_thread_id ?? null,
    gmailMessageId: row.gmail_message_id ?? null,
    lineItemIds: row.line_item_ids ? JSON.parse(row.line_item_ids) : [],
    sentAt: row.sent_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    openedAt: row.opened_at ?? null,
    repliedAt: row.replied_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const rowToVendorResponse = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    rfqId: row.rfq_id,
    prId: row.pr_id ?? null,
    vendorId: row.vendor_id ?? null,
    lineItemId: row.line_item_id ?? null,
    unitPrice: row.unit_price ?? null,
    totalPrice: row.total_price ?? null,
    leadTimeDays: row.lead_time_days ?? null,
    minOrderQty: row.min_order_qty ?? null,
    availability: row.availability ?? null,
    currency: row.currency ?? null,
    validUntil: row.valid_until ?? null,
    rawText: row.raw_text ?? null,
    parsedAt: row.parsed_at,
    createdAt: row.created_at,
  };
};

const rowToStatusLog = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    prId: row.pr_id,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    changedBy: row.changed_by ?? null,
    reason: row.reason ?? null,
    createdAt: row.created_at,
  };
};

/* ═══════════════════════════════════════════════════════
   Vendors Repository
   ═══════════════════════════════════════════════════════ */

export const createVendorsRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert({ name, email, phone, address, categories, leadTimeDays, currency, notes }) {
      const id = randomUUID();
      const ts = now();
      await db.execute(
        `INSERT INTO vendors (id, name, email, phone, address, categories,
          lead_time_days, currency, notes, active, created_at, updated_at)
        VALUES (@id, @name, @email, @phone, @address, @categories,
          @leadTimeDays, @currency, @notes, @active, @now, @now)`,
        {
          id, name, email,
          phone: phone ?? null,
          address: address ?? null,
          categories: categories ? JSON.stringify(categories) : null,
          leadTimeDays: leadTimeDays ?? null,
          currency: currency ?? "USD",
          notes: notes ?? null,
          active: 1,
          now: ts,
        }
      );
      return rowToVendor(await db.queryOne(`SELECT * FROM vendors WHERE id = @id`, { id }));
    },
    async getById(id) {
      if (!id) return null;
      return rowToVendor(await db.queryOne(`SELECT * FROM vendors WHERE id = @id`, { id }));
    },
    async getByEmail(email) {
      if (!email) return null;
      // Case-insensitive match — agents and humans both vary capitalisation.
      const rows = await db.query(
        `SELECT * FROM vendors WHERE LOWER(email) = LOWER(@email) LIMIT 1`,
        { email }
      );
      return rows.length > 0 ? rowToVendor(rows[0]) : null;
    },
    async listAll({ active, limit = 100 } = {}) {
      if (active === true || active === 1) {
        const rows = await db.query(
          `SELECT * FROM vendors WHERE active = 1 ORDER BY created_at DESC LIMIT @limit`,
          { limit }
        );
        return rows.map(rowToVendor);
      }
      const rows = await db.query(
        `SELECT * FROM vendors ORDER BY created_at DESC LIMIT @limit`,
        { limit }
      );
      return rows.map(rowToVendor);
    },
    async update(id, patch) {
      await db.execute(
        `UPDATE vendors SET
          name = COALESCE(@name, name),
          email = COALESCE(@email, email),
          phone = COALESCE(@phone, phone),
          address = COALESCE(@address, address),
          categories = COALESCE(@categories, categories),
          lead_time_days = COALESCE(@leadTimeDays, lead_time_days),
          currency = COALESCE(@currency, currency),
          notes = COALESCE(@notes, notes),
          updated_at = @now
        WHERE id = @id`,
        {
          id,
          name: patch.name ?? null,
          email: patch.email ?? null,
          phone: patch.phone ?? null,
          address: patch.address ?? null,
          categories: patch.categories ? JSON.stringify(patch.categories) : null,
          leadTimeDays: patch.leadTimeDays ?? null,
          currency: patch.currency ?? null,
          notes: patch.notes ?? null,
          now: now(),
        }
      );
      return rowToVendor(await db.queryOne(`SELECT * FROM vendors WHERE id = @id`, { id }));
    },
    async deactivate(id) {
      await db.execute(
        `UPDATE vendors SET active = 0, updated_at = @now WHERE id = @id`,
        { id, now: now() }
      );
      return rowToVendor(await db.queryOne(`SELECT * FROM vendors WHERE id = @id`, { id }));
    },
    async activate(id) {
      await db.execute(
        `UPDATE vendors SET active = 1, updated_at = @now WHERE id = @id`,
        { id, now: now() }
      );
      return rowToVendor(await db.queryOne(`SELECT * FROM vendors WHERE id = @id`, { id }));
    },
    async insertMaterial(vendorId, { materialName, category, unit, referencePrice, minOrderQty, notes }) {
      const ts = now();
      const info = await db.execute(
        `INSERT INTO vendor_materials (vendor_id, material_name, category, unit,
          reference_price, price_updated_at, min_order_qty, notes, created_at)
        VALUES (@vendorId, @materialName, @category, @unit,
          @referencePrice, @priceUpdatedAt, @minOrderQty, @notes, @now)`,
        {
          vendorId,
          materialName,
          category: category ?? null,
          unit: unit ?? null,
          referencePrice: referencePrice ?? null,
          priceUpdatedAt: referencePrice != null ? ts : null,
          minOrderQty: minOrderQty ?? null,
          notes: notes ?? null,
          now: ts,
        }
      );
      return rowToMaterial(await db.queryOne(
        `SELECT * FROM vendor_materials WHERE id = @id AND vendor_id = @vendorId`,
        { id: info.lastId, vendorId }
      ));
    },
    async getMaterialById(vendorId, materialId) {
      return rowToMaterial(await db.queryOne(
        `SELECT * FROM vendor_materials WHERE id = @materialId AND vendor_id = @vendorId`,
        { materialId, vendorId }
      ));
    },
    async updateMaterial(vendorId, materialId, patch) {
      await db.execute(
        `UPDATE vendor_materials SET
          material_name = COALESCE(@materialName, material_name),
          category = COALESCE(@category, category),
          unit = COALESCE(@unit, unit),
          reference_price = COALESCE(@referencePrice, reference_price),
          price_updated_at = COALESCE(@priceUpdatedAt, price_updated_at),
          min_order_qty = COALESCE(@minOrderQty, min_order_qty),
          notes = COALESCE(@notes, notes)
        WHERE id = @id AND vendor_id = @vendorId`,
        {
          id: materialId,
          vendorId,
          materialName: patch.materialName ?? null,
          category: patch.category ?? null,
          unit: patch.unit ?? null,
          referencePrice: patch.referencePrice ?? null,
          priceUpdatedAt: patch.referencePrice != null ? now() : null,
          minOrderQty: patch.minOrderQty ?? null,
          notes: patch.notes ?? null,
        }
      );
      return rowToMaterial(await db.queryOne(
        `SELECT * FROM vendor_materials WHERE id = @materialId AND vendor_id = @vendorId`,
        { materialId, vendorId }
      ));
    },
    async deleteMaterial(vendorId, materialId) {
      const info = await db.execute(
        `DELETE FROM vendor_materials WHERE id = @materialId AND vendor_id = @vendorId`,
        { materialId, vendorId }
      );
      return info.changes > 0;
    },
    async listMaterials(vendorId) {
      const rows = await db.query(
        `SELECT * FROM vendor_materials WHERE vendor_id = @vendorId ORDER BY created_at ASC`,
        { vendorId }
      );
      return rows.map(rowToMaterial);
    },
    async searchByMaterial(name, category, limit = 20) {
      const pattern = `%${name || category || ""}%`;
      const rows = await db.query(
        `SELECT DISTINCT v.* FROM vendors v
        INNER JOIN vendor_materials vm ON v.id = vm.vendor_id
        WHERE v.active = 1
          AND (vm.material_name LIKE @pattern OR vm.category LIKE @pattern)
        ORDER BY v.name ASC
        LIMIT @limit`,
        { pattern, limit }
      );
      return rows.map(rowToVendor);
    },

    async getKpis(vendorId) {
      // Response rate
      const rfqStats = await db.queryOne(
        `SELECT
          COUNT(*) as total_rfqs,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
          SUM(CASE WHEN status IN ('expired','send_failed') THEN 1 ELSE 0 END) as missed
        FROM rfq_emails WHERE vendor_id = @vendorId`,
        { vendorId }
      );

      const totalRfqs = rfqStats?.total_rfqs ?? 0;
      const replied = rfqStats?.replied ?? 0;
      const responseRate = totalRfqs > 0 ? replied / totalRfqs : 0;

      // Avg response time
      const avgRow = await db.queryOne(
        `SELECT AVG(replied_at - sent_at) as avg_response_ms
        FROM rfq_emails WHERE vendor_id = @vendorId AND status = 'replied'
          AND replied_at IS NOT NULL AND sent_at IS NOT NULL`,
        { vendorId }
      );
      const avgResponseMs = avgRow?.avg_response_ms ?? null;
      const avgResponseDays = avgResponseMs != null ? avgResponseMs / (1000 * 60 * 60 * 24) : null;

      // PRs served
      const prsRow = await db.queryOne(
        `SELECT COUNT(DISTINCT pr_id) as prs_served
        FROM rfq_emails WHERE vendor_id = @vendorId AND status = 'replied'`,
        { vendorId }
      );
      const prsServed = prsRow?.prs_served ?? 0;

      // Total value
      const valueRow = await db.queryOne(
        `SELECT SUM(vr.unit_price * li.quantity) as total_value, vr.currency
        FROM vendor_responses vr
        JOIN pr_line_items li ON vr.line_item_id = li.id
        WHERE vr.vendor_id = @vendorId
        GROUP BY vr.currency
        ORDER BY total_value DESC
        LIMIT 1`,
        { vendorId }
      );
      const totalValue = valueRow?.total_value ?? null;
      const currency = valueRow?.currency ?? "USD";

      return {
        totalRfqs,
        responseRate,
        avgResponseDays,
        prsServed,
        totalValue,
        currency,
      };
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Purchase Requests Repository
   ═══════════════════════════════════════════════════════ */

export const createPurchaseRequestsRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert(title, requestedBy, deadline, notes) {
      const id = randomUUID();
      const ts = now();
      await db.execute(
        `INSERT INTO purchase_requests (id, title, status, requested_by, deadline, notes, created_at, updated_at)
        VALUES (@id, @title, @status, @requestedBy, @deadline, @notes, @now, @now)`,
        {
          id, title, status: "pending_approval",
          requestedBy: requestedBy ?? null,
          deadline: deadline ?? null,
          notes: notes ?? null,
          now: ts,
        }
      );
      return rowToPr(await db.queryOne(`SELECT * FROM purchase_requests WHERE id = @id`, { id }));
    },
    async insertWithItems(title, requestedBy, deadline, notes, items) {
      const id = randomUUID();
      const ts = now();
      await db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO purchase_requests (id, title, status, requested_by, deadline, notes, created_at, updated_at)
          VALUES (@id, @title, @status, @requestedBy, @deadline, @notes, @now, @now)`,
          {
            id, title, status: "pending_approval",
            requestedBy: requestedBy ?? null,
            deadline: deadline ?? null,
            notes: notes ?? null,
            now: ts,
          }
        );
        for (const item of (items || [])) {
          await tx.execute(
            `INSERT INTO pr_line_items (pr_id, material_name, specification, quantity, unit, notes, created_at)
            VALUES (@prId, @materialName, @specification, @quantity, @unit, @notes, @now)`,
            {
              prId: id,
              materialName: item.materialName,
              specification: item.specification ?? null,
              quantity: item.quantity,
              unit: item.unit,
              notes: item.notes ?? null,
              now: ts,
            }
          );
        }
      });
      const pr = rowToPr(await db.queryOne(`SELECT * FROM purchase_requests WHERE id = @id`, { id }));
      const lineRows = await db.query(`SELECT * FROM pr_line_items WHERE pr_id = @id ORDER BY id ASC`, { id });
      pr.lineItems = lineRows.map(rowToLineItem);
      return pr;
    },
    async deleteById(id) {
      // Some child tables don't have ON DELETE CASCADE — delete them first.
      await db.transaction(async (tx) => {
        await tx.execute(`DELETE FROM pr_item_status_log WHERE pr_id = @id`, { id });
        await tx.execute(`DELETE FROM rfq_emails WHERE pr_id = @id`, { id });
        await tx.execute(`DELETE FROM vendor_responses WHERE pr_id = @id`, { id });
        await tx.execute(`DELETE FROM purchase_requests WHERE id = @id`, { id });
      });
      return true;
    },
    async getById(id) {
      if (!id) return null;
      const pr = rowToPr(await db.queryOne(`SELECT * FROM purchase_requests WHERE id = @id`, { id }));
      if (!pr) return null;
      const lineRows = await db.query(`SELECT * FROM pr_line_items WHERE pr_id = @id ORDER BY id ASC`, { id });
      pr.lineItems = lineRows.map(rowToLineItem);
      return pr;
    },
    async listAll(status, search, limit = 100) {
      let rows;
      if (status && search) {
        rows = await db.query(
          `SELECT * FROM purchase_requests
          WHERE status = @status AND title LIKE @pattern
          ORDER BY created_at DESC LIMIT @limit`,
          { status, pattern: `%${search}%`, limit }
        );
      } else if (status) {
        rows = await db.query(
          `SELECT * FROM purchase_requests WHERE status = @status ORDER BY created_at DESC LIMIT @limit`,
          { status, limit }
        );
      } else if (search) {
        rows = await db.query(
          `SELECT * FROM purchase_requests
          WHERE title LIKE @pattern
          ORDER BY created_at DESC LIMIT @limit`,
          { pattern: `%${search}%`, limit }
        );
      } else {
        rows = await db.query(
          `SELECT * FROM purchase_requests ORDER BY created_at DESC LIMIT @limit`,
          { limit }
        );
      }
      const prs = rows.map(rowToPr);
      if (prs.length === 0) return prs;
      // Single batch query — build dynamic IN clause with named params
      const params = {};
      const placeholders = prs.map((p, i) => { params[`id${i}`] = p.id; return `@id${i}`; }).join(",");
      const allItems = await db.query(
        `SELECT * FROM pr_line_items WHERE pr_id IN (${placeholders}) ORDER BY created_at ASC`,
        params
      );
      const itemsByPr = new Map();
      for (const row of allItems) {
        const prId = row.pr_id;
        if (!itemsByPr.has(prId)) itemsByPr.set(prId, []);
        itemsByPr.get(prId).push(rowToLineItem(row));
      }
      for (const pr of prs) {
        pr.lineItems = itemsByPr.get(pr.id) || [];
      }
      return prs;
    },
    async updateDraft(id, patch) {
      const info = await db.execute(
        `UPDATE purchase_requests SET
          title = COALESCE(@title, title),
          deadline = COALESCE(@deadline, deadline),
          notes = COALESCE(@notes, notes),
          updated_at = @now
        WHERE id = @id AND status = 'pending_approval'`,
        {
          id,
          title: patch.title ?? null,
          deadline: patch.deadline ?? null,
          notes: patch.notes ?? null,
          now: now(),
        }
      );
      if (info.changes === 0) return null;
      return rowToPr(await db.queryOne(`SELECT * FROM purchase_requests WHERE id = @id`, { id }));
    },
    async addLineItem(prId, item) {
      const ts = now();
      const info = await db.execute(
        `INSERT INTO pr_line_items (pr_id, material_name, specification, quantity, unit, notes, created_at)
        VALUES (@prId, @materialName, @specification, @quantity, @unit, @notes, @now)`,
        {
          prId,
          materialName: item.materialName,
          specification: item.specification ?? null,
          quantity: item.quantity,
          unit: item.unit,
          notes: item.notes ?? null,
          now: ts,
        }
      );
      return rowToLineItem(await db.queryOne(
        `SELECT * FROM pr_line_items WHERE id = @id AND pr_id = @prId`,
        { id: info.lastId, prId }
      ));
    },
    async updateLineItem(prId, itemId, patch) {
      await db.execute(
        `UPDATE pr_line_items SET
          material_name = COALESCE(@materialName, material_name),
          specification = COALESCE(@specification, specification),
          quantity = COALESCE(@quantity, quantity),
          unit = COALESCE(@unit, unit),
          notes = COALESCE(@notes, notes)
        WHERE id = @id AND pr_id = @prId`,
        {
          id: itemId,
          prId,
          materialName: patch.materialName ?? null,
          specification: patch.specification ?? null,
          quantity: patch.quantity ?? null,
          unit: patch.unit ?? null,
          notes: patch.notes ?? null,
        }
      );
      return rowToLineItem(await db.queryOne(
        `SELECT * FROM pr_line_items WHERE id = @itemId AND pr_id = @prId`,
        { itemId, prId }
      ));
    },
    async removeLineItem(prId, itemId) {
      const info = await db.execute(
        `DELETE FROM pr_line_items WHERE id = @itemId AND pr_id = @prId`,
        { itemId, prId }
      );
      return info.changes > 0;
    },
    async getLineItems(prId) {
      const rows = await db.query(
        `SELECT * FROM pr_line_items WHERE pr_id = @prId ORDER BY id ASC`,
        { prId }
      );
      return rows.map(rowToLineItem);
    },
    async transition(id, fromStatus, toStatus, extra = {}) {
      const info = await db.execute(
        `UPDATE purchase_requests SET
          status = @toStatus,
          approved_by = COALESCE(@approvedBy, approved_by),
          rejected_reason = COALESCE(@rejectedReason, rejected_reason),
          sourcing_task_id = COALESCE(@sourcingTaskId, sourcing_task_id),
          analysis_task_id = COALESCE(@analysisTaskId, analysis_task_id),
          updated_at = @now
        WHERE id = @id AND status = @fromStatus`,
        {
          id,
          fromStatus,
          toStatus,
          approvedBy: extra.approvedBy ?? null,
          rejectedReason: extra.rejectedReason ?? null,
          sourcingTaskId: extra.sourcingTaskId ?? null,
          analysisTaskId: extra.analysisTaskId ?? null,
          now: now(),
        }
      );
      if (info.changes === 0) return null;
      return rowToPr(await db.queryOne(`SELECT * FROM purchase_requests WHERE id = @id`, { id }));
    },
    async insertShortlist(prId, entries) {
      const ts = now();
      return db.transaction(async (tx) => {
        // Append, don't replace — the agent may submit the shortlist in
        // multiple calls (e.g. one per item). De-dupe by (vendor, line_item).
        const existing = await tx.query(
          `SELECT vendor_id, line_item_id FROM pr_vendor_shortlist WHERE pr_id = @prId`,
          { prId }
        );
        const seen = new Set(
          existing.map((r) => `${r.vendor_id}::${r.line_item_id ?? ""}`)
        );
        const out = [];
        for (const e of entries) {
          const dedupeKey = `${e.vendorId}::${e.lineItemId ?? ""}`;
          if (seen.has(dedupeKey)) continue;   // skip duplicate
          seen.add(dedupeKey);

          const rfxTypes = Array.isArray(e.rfxTypes) ? e.rfxTypes : [];
          const info = await tx.execute(
            `INSERT INTO pr_vendor_shortlist (pr_id, vendor_id, line_item_id, reference_price, notes, rfx_types, created_at)
            VALUES (@prId, @vendorId, @lineItemId, @referencePrice, @notes, @rfxTypes, @now)`,
            {
              prId,
              vendorId: e.vendorId,
              lineItemId: e.lineItemId ?? null,
              referencePrice: e.referencePrice ?? null,
              notes: e.notes ?? null,
              rfxTypes: rfxTypes.length > 0 ? JSON.stringify(rfxTypes) : null,
              now: ts,
            }
          );
          out.push({
            id: Number(info.lastId),
            prId,
            vendorId: e.vendorId,
            lineItemId: e.lineItemId ?? null,
            referencePrice: e.referencePrice ?? null,
            notes: e.notes ?? null,
            rfxTypes,
            createdAt: ts,
          });
        }
        return out;
      });
    },
    async getShortlist(prId) {
      const rows = await db.query(
        `SELECT s.*, v.name AS vendor_name, v.email AS vendor_email,
                v.lead_time_days AS vendor_lead_time, v.currency AS vendor_currency
         FROM pr_vendor_shortlist s
         LEFT JOIN vendors v ON v.id = s.vendor_id
         WHERE s.pr_id = @prId
         ORDER BY s.id ASC`,
        { prId }
      );
      return rows.map((row) => ({
        ...rowToShortlistEntry(row),
        vendorName: row.vendor_name ?? null,
        vendorEmail: row.vendor_email ?? null,
        vendorLeadTimeDays: row.vendor_lead_time ?? null,
        vendorCurrency: row.vendor_currency ?? null,
      }));
    },

    async getLineItem(prId, itemId) {
      return rowToLineItem(await db.queryOne(
        `SELECT * FROM pr_line_items WHERE id = @itemId AND pr_id = @prId`,
        { itemId, prId }
      ));
    },
    async updateItemStatus(prId, itemId, status, { selectedVendorId, selectedPrice, poNumber, note } = {}) {
      await db.execute(
        `UPDATE pr_line_items SET
          status = @status,
          selected_vendor_id = COALESCE(@selectedVendorId, selected_vendor_id),
          selected_price = COALESCE(@selectedPrice, selected_price),
          po_number = COALESCE(@poNumber, po_number),
          note = COALESCE(@note, note)
        WHERE id = @itemId AND pr_id = @prId`,
        {
          status,
          selectedVendorId: selectedVendorId ?? null,
          selectedPrice: selectedPrice ?? null,
          poNumber: poNumber ?? null,
          note: note ?? null,
          itemId,
          prId,
        }
      );
      return rowToLineItem(await db.queryOne(
        `SELECT * FROM pr_line_items WHERE id = @itemId AND pr_id = @prId`,
        { itemId, prId }
      ));
    },
    async getCompletedHistory({ materialName, vendorId, limit = 50 } = {}) {
      let where = `WHERE pr.status = 'completed'`;
      const params = {};
      if (materialName) {
        where += ` AND li.material_name LIKE @materialPattern`;
        params.materialPattern = `%${materialName}%`;
      }
      if (vendorId) {
        where += ` AND vr.vendor_id = @vendorId`;
        params.vendorId = vendorId;
      }
      params.limit = limit;

      const rows = await db.query(
        `SELECT
          pr.id          AS pr_id,
          pr.title       AS pr_title,
          pr.updated_at  AS completed_at,
          li.material_name,
          li.quantity,
          li.unit,
          v.name         AS vendor_name,
          vr.unit_price,
          vr.currency,
          vr.lead_time_days
        FROM purchase_requests pr
        JOIN pr_line_items li       ON li.pr_id = pr.id
        LEFT JOIN vendor_responses vr ON vr.pr_id = pr.id AND vr.line_item_id = li.id
        LEFT JOIN vendors v          ON v.id = vr.vendor_id
        ${where}
        ORDER BY pr.updated_at DESC
        LIMIT @limit`,
        params
      );

      // Group rows by PR
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.pr_id)) {
          map.set(r.pr_id, {
            prId: r.pr_id,
            prTitle: r.pr_title,
            completedAt: r.completed_at,
            items: [],
          });
        }
        map.get(r.pr_id).items.push({
          materialName: r.material_name,
          quantity: r.quantity,
          unit: r.unit,
          vendorName: r.vendor_name ?? null,
          unitPrice: r.unit_price ?? null,
          currency: r.currency ?? null,
          leadTimeDays: r.lead_time_days ?? null,
        });
      }
      return [...map.values()];
    },
  };
};

/* ═══════════════════════════════════════════════════════
   RFQ Repository
   ═══════════════════════════════════════════════════════ */

export const createRfqRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert({ prId, vendorId, toEmail, lineItemIds }) {
      const id = randomUUID();
      const ts = now();
      await db.execute(
        `INSERT INTO rfq_emails (id, pr_id, vendor_id, to_email, status,
          line_item_ids, created_at, updated_at)
        VALUES (@id, @prId, @vendorId, @toEmail, @status,
          @lineItemIds, @now, @now)`,
        {
          id, prId, vendorId, toEmail,
          status: "pending",
          lineItemIds: lineItemIds ? JSON.stringify(lineItemIds) : null,
          now: ts,
        }
      );
      return rowToRfq(await db.queryOne(`SELECT * FROM rfq_emails WHERE id = @id`, { id }));
    },
    async getById(id) {
      if (!id) return null;
      return rowToRfq(await db.queryOne(`SELECT * FROM rfq_emails WHERE id = @id`, { id }));
    },
    async listByPr(prId) {
      const rows = await db.query(
        `SELECT * FROM rfq_emails WHERE pr_id = @prId ORDER BY created_at ASC`,
        { prId }
      );
      return rows.map(rowToRfq);
    },
    async updateStatus(id, status, metadata = {}) {
      await db.execute(
        `UPDATE rfq_emails SET
          status = @status,
          sent_at = COALESCE(@sentAt, sent_at),
          delivered_at = COALESCE(@deliveredAt, delivered_at),
          opened_at = COALESCE(@openedAt, opened_at),
          replied_at = COALESCE(@repliedAt, replied_at),
          updated_at = @now
        WHERE id = @id`,
        {
          id, status,
          sentAt: metadata.sentAt ?? null,
          deliveredAt: metadata.deliveredAt ?? null,
          openedAt: metadata.openedAt ?? null,
          repliedAt: metadata.repliedAt ?? null,
          now: now(),
        }
      );
      return rowToRfq(await db.queryOne(`SELECT * FROM rfq_emails WHERE id = @id`, { id }));
    },
    async updateGmailIds(id, gmailThreadId, gmailMessageId) {
      await db.execute(
        `UPDATE rfq_emails SET
          gmail_thread_id = @gmailThreadId,
          gmail_message_id = @gmailMessageId,
          updated_at = @now
        WHERE id = @id`,
        {
          id,
          gmailThreadId: gmailThreadId ?? null,
          gmailMessageId: gmailMessageId ?? null,
          now: now(),
        }
      );
      return rowToRfq(await db.queryOne(`SELECT * FROM rfq_emails WHERE id = @id`, { id }));
    },
    async listPending() {
      const rows = await db.query(
        `SELECT * FROM rfq_emails WHERE status = 'pending' ORDER BY created_at ASC`,
        {}
      );
      return rows.map(rowToRfq);
    },
    async listByStatus(status) {
      const rows = await db.query(
        `SELECT * FROM rfq_emails WHERE status = @status ORDER BY created_at ASC`,
        { status }
      );
      return rows.map(rowToRfq);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Vendor Responses Repository
   ═══════════════════════════════════════════════════════ */

export const createVendorResponsesRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert(data) {
      const ts = now();
      const info = await db.execute(
        `INSERT INTO vendor_responses (rfq_id, pr_id, vendor_id, line_item_id,
          unit_price, total_price, lead_time_days, min_order_qty, availability,
          currency, valid_until, raw_text, parsed_at, created_at)
        VALUES (@rfqId, @prId, @vendorId, @lineItemId,
          @unitPrice, @totalPrice, @leadTimeDays, @minOrderQty, @availability,
          @currency, @validUntil, @rawText, @parsedAt, @now)`,
        {
          rfqId: data.rfqId,
          prId: data.prId ?? null,
          vendorId: data.vendorId ?? null,
          lineItemId: data.lineItemId ?? null,
          unitPrice: data.unitPrice ?? null,
          totalPrice: data.totalPrice ?? null,
          leadTimeDays: data.leadTimeDays ?? null,
          minOrderQty: data.minOrderQty ?? null,
          availability: data.availability ?? null,
          currency: data.currency ?? null,
          validUntil: data.validUntil ?? null,
          rawText: data.rawText ?? null,
          parsedAt: data.parsedAt ?? ts,
          now: ts,
        }
      );
      return {
        id: Number(info.lastId),
        ...data,
        parsedAt: data.parsedAt ?? ts,
        createdAt: ts,
      };
    },
    async listByPr(prId) {
      const rows = await db.query(
        `SELECT * FROM vendor_responses WHERE pr_id = @prId ORDER BY created_at ASC`,
        { prId }
      );
      return rows.map(rowToVendorResponse);
    },
    async listByRfq(rfqId) {
      const rows = await db.query(
        `SELECT * FROM vendor_responses WHERE rfq_id = @rfqId ORDER BY created_at ASC`,
        { rfqId }
      );
      return rows.map(rowToVendorResponse);
    },
    async listByVendor(vendorId) {
      const rows = await db.query(
        `SELECT * FROM vendor_responses WHERE vendor_id = @vendorId ORDER BY created_at ASC`,
        { vendorId }
      );
      return rows.map(rowToVendorResponse);
    },
    async listCompetitorsForLineItem(prId, lineItemId) {
      const rows = await db.query(
        `SELECT * FROM vendor_responses
        WHERE pr_id = @prId AND line_item_id = @lineItemId AND unit_price IS NOT NULL`,
        { prId, lineItemId }
      );
      return rows.map(rowToVendorResponse);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Status Log Repository
   ═══════════════════════════════════════════════════════ */

export const createStatusLogRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert(prId, fromStatus, toStatus, changedBy, reason) {
      const ts = now();
      const info = await db.execute(
        `INSERT INTO pr_status_log (pr_id, from_status, to_status, changed_by, reason, created_at)
        VALUES (@prId, @fromStatus, @toStatus, @changedBy, @reason, @now)`,
        {
          prId,
          fromStatus: fromStatus ?? null,
          toStatus,
          changedBy: changedBy ?? null,
          reason: reason ?? null,
          now: ts,
        }
      );
      return {
        id: Number(info.lastId),
        prId,
        fromStatus: fromStatus ?? null,
        toStatus,
        changedBy: changedBy ?? null,
        reason: reason ?? null,
        createdAt: ts,
      };
    },
    async listByPr(prId) {
      const rows = await db.query(
        `SELECT * FROM pr_status_log WHERE pr_id = @prId ORDER BY created_at ASC, id ASC`,
        { prId }
      );
      return rows.map(rowToStatusLog);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Item Status Log Repository
   ═══════════════════════════════════════════════════════ */

const rowToItemStatusLog = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    lineItemId: row.line_item_id,
    prId: row.pr_id,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    changedBy: row.changed_by ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
};

export const createItemStatusLogRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert(lineItemId, prId, fromStatus, toStatus, changedBy, note) {
      const ts = now();
      const info = await db.execute(
        `INSERT INTO pr_item_status_log (line_item_id, pr_id, from_status, to_status, changed_by, note, created_at)
        VALUES (@lineItemId, @prId, @fromStatus, @toStatus, @changedBy, @note, @now)`,
        {
          lineItemId,
          prId,
          fromStatus: fromStatus ?? null,
          toStatus,
          changedBy: changedBy ?? null,
          note: note ?? null,
          now: ts,
        }
      );
      return {
        id: Number(info.lastId),
        lineItemId,
        prId,
        fromStatus: fromStatus ?? null,
        toStatus,
        changedBy: changedBy ?? null,
        note: note ?? null,
        createdAt: ts,
      };
    },
    async listByItem(lineItemId) {
      const rows = await db.query(
        `SELECT * FROM pr_item_status_log WHERE line_item_id = @lineItemId ORDER BY created_at ASC, id ASC`,
        { lineItemId }
      );
      return rows.map(rowToItemStatusLog);
    },
    async listByPr(prId) {
      const rows = await db.query(
        `SELECT * FROM pr_item_status_log WHERE pr_id = @prId ORDER BY created_at ASC, id ASC`,
        { prId }
      );
      return rows.map(rowToItemStatusLog);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   RFx Event Log Repository — events the mail service pushes
   ═══════════════════════════════════════════════════════ */

const rowToRfxEvent = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    rfxId: row.rfx_id,
    prId: row.pr_id ?? null,
    vendorId: row.vendor_id ?? null,
    event: row.event,
    detail: row.detail ? safeParseJson(row.detail) : null,
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
  };
};

const safeParseJson = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};

/* ═══════════════════════════════════════════════════════
   RFx Send Log Repository — TEMP debug — clean later
   Captures the raw mail-service response for every send.
   ═══════════════════════════════════════════════════════ */

const rowToRfxSend = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    rfxId: row.rfx_id,
    prId: row.pr_id ?? null,
    vendorId: row.vendor_id ?? null,
    ok: row.ok === 1 || row.ok === true,
    mock: row.mock === 1 || row.mock === true,
    statusCode: row.status_code ?? null,
    responseBody: row.response_body ? safeParseJson(row.response_body) : null,
    error: row.error ?? null,
    requestSummary: row.request_summary ? safeParseJson(row.request_summary) : null,
    createdAt: Number(row.created_at),
  };
};

export const createRfxSendLogRepository = (db) => {
  const now = () => Date.now();
  return {
    async insert({ rfxId, prId, vendorId, ok, mock, statusCode, responseBody, error, requestSummary }) {
      await db.execute(
        `INSERT INTO rfx_send_log
           (rfx_id, pr_id, vendor_id, ok, mock, status_code, response_body, error, request_summary, created_at)
         VALUES (@rfxId, @prId, @vendorId, @ok, @mock, @statusCode, @responseBody, @error, @requestSummary, @now)`,
        {
          rfxId,
          prId: prId ?? null,
          vendorId: vendorId ?? null,
          ok: ok ? 1 : 0,
          mock: mock ? 1 : 0,
          statusCode: statusCode ?? null,
          responseBody: responseBody != null ? JSON.stringify(responseBody) : null,
          error: error ?? null,
          requestSummary: requestSummary != null ? JSON.stringify(requestSummary) : null,
          now: now(),
        }
      );
    },
    async listByPr(prId, limit = 100) {
      const rows = await db.query(
        `SELECT * FROM rfx_send_log WHERE pr_id = @prId ORDER BY created_at DESC, id DESC LIMIT @limit`,
        { prId, limit }
      );
      return rows.map(rowToRfxSend);
    },
    async listByRfx(rfxId) {
      const rows = await db.query(
        `SELECT * FROM rfx_send_log WHERE rfx_id = @rfxId ORDER BY created_at ASC, id ASC`,
        { rfxId }
      );
      return rows.map(rowToRfxSend);
    },
  };
};

export const createRfxEventLogRepository = (db) => {
  const now = () => Date.now();

  return {
    async insert({ rfxId, prId, vendorId, event, detail, occurredAt }) {
      try {
        const info = await db.execute(
          `INSERT INTO rfx_event_log (rfx_id, pr_id, vendor_id, event, detail, occurred_at, received_at)
           VALUES (@rfxId, @prId, @vendorId, @event, @detail, @occurredAt, @receivedAt)`,
          {
            rfxId,
            prId: prId ?? null,
            vendorId: vendorId ?? null,
            event,
            detail: detail != null ? JSON.stringify(detail) : null,
            occurredAt,
            receivedAt: now(),
          }
        );
        return { inserted: true, id: Number(info.lastId) };
      } catch (err) {
        // Idempotent: duplicate (rfx_id,event,occurred_at) is fine
        if (/UNIQUE/i.test(err?.message || "") || err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.code === "23505") {
          return { inserted: false, duplicate: true };
        }
        throw err;
      }
    },
    async listByRfx(rfxId) {
      const rows = await db.query(
        `SELECT * FROM rfx_event_log WHERE rfx_id = @rfxId ORDER BY occurred_at ASC, id ASC`,
        { rfxId }
      );
      return rows.map(rowToRfxEvent);
    },
  };
};
