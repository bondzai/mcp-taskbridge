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
    createdAt: row.created_at,
  };
};

const rowToShortlistEntry = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    prId: row.pr_id,
    vendorId: row.vendor_id,
    lineItemId: row.line_item_id ?? null,
    referencePrice: row.reference_price ?? null,
    notes: row.notes ?? null,
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
  const insertStmt = db.prepare(`
    INSERT INTO vendors (id, name, email, phone, address, categories,
      lead_time_days, currency, notes, active, created_at, updated_at)
    VALUES (@id, @name, @email, @phone, @address, @categories,
      @leadTimeDays, @currency, @notes, @active, @now, @now)
  `);
  const selectById = db.prepare(`SELECT * FROM vendors WHERE id = ?`);
  const selectAll = db.prepare(`
    SELECT * FROM vendors ORDER BY created_at DESC LIMIT ?
  `);
  const selectAllActive = db.prepare(`
    SELECT * FROM vendors WHERE active = 1 ORDER BY created_at DESC LIMIT ?
  `);
  const updateStmt = db.prepare(`
    UPDATE vendors SET
      name = COALESCE(@name, name),
      email = COALESCE(@email, email),
      phone = COALESCE(@phone, phone),
      address = COALESCE(@address, address),
      categories = COALESCE(@categories, categories),
      lead_time_days = COALESCE(@leadTimeDays, lead_time_days),
      currency = COALESCE(@currency, currency),
      notes = COALESCE(@notes, notes),
      updated_at = @now
    WHERE id = @id
  `);
  const deactivateStmt = db.prepare(`
    UPDATE vendors SET active = 0, updated_at = @now WHERE id = @id
  `);
  const activateStmt = db.prepare(`
    UPDATE vendors SET active = 1, updated_at = @now WHERE id = @id
  `);

  // Materials
  const insertMaterialStmt = db.prepare(`
    INSERT INTO vendor_materials (vendor_id, material_name, category, unit,
      reference_price, price_updated_at, min_order_qty, notes, created_at)
    VALUES (@vendorId, @materialName, @category, @unit,
      @referencePrice, @priceUpdatedAt, @minOrderQty, @notes, @now)
  `);
  const selectMaterials = db.prepare(`
    SELECT * FROM vendor_materials WHERE vendor_id = ? ORDER BY created_at ASC
  `);
  const searchByMaterialStmt = db.prepare(`
    SELECT DISTINCT v.* FROM vendors v
    INNER JOIN vendor_materials vm ON v.id = vm.vendor_id
    WHERE v.active = 1
      AND (vm.material_name LIKE @pattern OR vm.category LIKE @pattern)
    ORDER BY v.name ASC
    LIMIT @limit
  `);
  const selectMaterialById = db.prepare(`
    SELECT * FROM vendor_materials WHERE id = ? AND vendor_id = ?
  `);
  const updateMaterialStmt = db.prepare(`
    UPDATE vendor_materials SET
      material_name = COALESCE(@materialName, material_name),
      category = COALESCE(@category, category),
      unit = COALESCE(@unit, unit),
      reference_price = COALESCE(@referencePrice, reference_price),
      price_updated_at = COALESCE(@priceUpdatedAt, price_updated_at),
      min_order_qty = COALESCE(@minOrderQty, min_order_qty),
      notes = COALESCE(@notes, notes)
    WHERE id = @id AND vendor_id = @vendorId
  `);
  const deleteMaterialStmt = db.prepare(`
    DELETE FROM vendor_materials WHERE id = ? AND vendor_id = ?
  `);

  const now = () => Date.now();

  return {
    insert({ name, email, phone, address, categories, leadTimeDays, currency, notes }) {
      const id = randomUUID();
      insertStmt.run({
        id, name, email,
        phone: phone ?? null,
        address: address ?? null,
        categories: categories ? JSON.stringify(categories) : null,
        leadTimeDays: leadTimeDays ?? null,
        currency: currency ?? "USD",
        notes: notes ?? null,
        active: 1,
        now: now(),
      });
      return rowToVendor(selectById.get(id));
    },
    getById(id) {
      if (!id) return null;
      return rowToVendor(selectById.get(id));
    },
    listAll({ active, limit = 100 } = {}) {
      if (active === true || active === 1) {
        return selectAllActive.all(limit).map(rowToVendor);
      }
      return selectAll.all(limit).map(rowToVendor);
    },
    update(id, patch) {
      updateStmt.run({
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
      });
      return rowToVendor(selectById.get(id));
    },
    deactivate(id) {
      deactivateStmt.run({ id, now: now() });
      return rowToVendor(selectById.get(id));
    },
    activate(id) {
      activateStmt.run({ id, now: now() });
      return rowToVendor(selectById.get(id));
    },
    insertMaterial(vendorId, { materialName, category, unit, referencePrice, minOrderQty, notes }) {
      const info = insertMaterialStmt.run({
        vendorId,
        materialName,
        category: category ?? null,
        unit: unit ?? null,
        referencePrice: referencePrice ?? null,
        priceUpdatedAt: referencePrice != null ? now() : null,
        minOrderQty: minOrderQty ?? null,
        notes: notes ?? null,
        now: now(),
      });
      return rowToMaterial(selectMaterialById.get(Number(info.lastInsertRowid), vendorId));
    },
    getMaterialById(vendorId, materialId) {
      return rowToMaterial(selectMaterialById.get(materialId, vendorId));
    },
    updateMaterial(vendorId, materialId, patch) {
      updateMaterialStmt.run({
        id: materialId,
        vendorId,
        materialName: patch.materialName ?? null,
        category: patch.category ?? null,
        unit: patch.unit ?? null,
        referencePrice: patch.referencePrice ?? null,
        priceUpdatedAt: patch.referencePrice != null ? now() : null,
        minOrderQty: patch.minOrderQty ?? null,
        notes: patch.notes ?? null,
      });
      return rowToMaterial(selectMaterialById.get(materialId, vendorId));
    },
    deleteMaterial(vendorId, materialId) {
      const info = deleteMaterialStmt.run(materialId, vendorId);
      return info.changes > 0;
    },
    listMaterials(vendorId) {
      return selectMaterials.all(vendorId).map(rowToMaterial);
    },
    searchByMaterial(name, category, limit = 20) {
      const pattern = `%${name || category || ""}%`;
      return searchByMaterialStmt.all({ pattern, limit }).map(rowToVendor);
    },

    getKpis(vendorId) {
      // Response rate
      const rfqStats = db.prepare(`
        SELECT
          COUNT(*) as total_rfqs,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
          SUM(CASE WHEN status IN ('expired','send_failed') THEN 1 ELSE 0 END) as missed
        FROM rfq_emails WHERE vendor_id = ?
      `).get(vendorId);

      const totalRfqs = rfqStats?.total_rfqs ?? 0;
      const replied = rfqStats?.replied ?? 0;
      const responseRate = totalRfqs > 0 ? replied / totalRfqs : 0;

      // Avg response time
      const avgRow = db.prepare(`
        SELECT AVG(replied_at - sent_at) as avg_response_ms
        FROM rfq_emails WHERE vendor_id = ? AND status = 'replied'
          AND replied_at IS NOT NULL AND sent_at IS NOT NULL
      `).get(vendorId);
      const avgResponseMs = avgRow?.avg_response_ms ?? null;
      const avgResponseDays = avgResponseMs != null ? avgResponseMs / (1000 * 60 * 60 * 24) : null;

      // PRs served
      const prsRow = db.prepare(`
        SELECT COUNT(DISTINCT pr_id) as prs_served
        FROM rfq_emails WHERE vendor_id = ? AND status = 'replied'
      `).get(vendorId);
      const prsServed = prsRow?.prs_served ?? 0;

      // Total value
      const valueRow = db.prepare(`
        SELECT SUM(vr.unit_price * li.quantity) as total_value, vr.currency
        FROM vendor_responses vr
        JOIN pr_line_items li ON vr.line_item_id = li.id
        WHERE vr.vendor_id = ?
        GROUP BY vr.currency
        ORDER BY total_value DESC
        LIMIT 1
      `).get(vendorId);
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
  const insertPrStmt = db.prepare(`
    INSERT INTO purchase_requests (id, title, status, requested_by, deadline, notes, created_at, updated_at)
    VALUES (@id, @title, @status, @requestedBy, @deadline, @notes, @now, @now)
  `);
  const selectPrById = db.prepare(`SELECT * FROM purchase_requests WHERE id = ?`);
  const selectPrAll = db.prepare(`
    SELECT * FROM purchase_requests ORDER BY created_at DESC LIMIT ?
  `);
  const selectPrByStatus = db.prepare(`
    SELECT * FROM purchase_requests WHERE status = @status ORDER BY created_at DESC LIMIT @limit
  `);
  const selectPrSearch = db.prepare(`
    SELECT * FROM purchase_requests
    WHERE title LIKE @pattern
    ORDER BY created_at DESC LIMIT @limit
  `);
  const selectPrByStatusAndSearch = db.prepare(`
    SELECT * FROM purchase_requests
    WHERE status = @status AND title LIKE @pattern
    ORDER BY created_at DESC LIMIT @limit
  `);
  const updateDraftStmt = db.prepare(`
    UPDATE purchase_requests SET
      title = COALESCE(@title, title),
      deadline = COALESCE(@deadline, deadline),
      notes = COALESCE(@notes, notes),
      updated_at = @now
    WHERE id = @id AND status = 'draft'
  `);
  const transitionStmt = db.prepare(`
    UPDATE purchase_requests SET
      status = @toStatus,
      approved_by = COALESCE(@approvedBy, approved_by),
      rejected_reason = COALESCE(@rejectedReason, rejected_reason),
      sourcing_task_id = COALESCE(@sourcingTaskId, sourcing_task_id),
      analysis_task_id = COALESCE(@analysisTaskId, analysis_task_id),
      updated_at = @now
    WHERE id = @id AND status = @fromStatus
  `);

  // Line items
  const insertLineItemStmt = db.prepare(`
    INSERT INTO pr_line_items (pr_id, material_name, specification, quantity, unit, notes, created_at)
    VALUES (@prId, @materialName, @specification, @quantity, @unit, @notes, @now)
  `);
  const selectLineItems = db.prepare(`
    SELECT * FROM pr_line_items WHERE pr_id = ? ORDER BY id ASC
  `);
  const selectLineItemById = db.prepare(`
    SELECT * FROM pr_line_items WHERE id = ? AND pr_id = ?
  `);
  const updateLineItemStmt = db.prepare(`
    UPDATE pr_line_items SET
      material_name = COALESCE(@materialName, material_name),
      specification = COALESCE(@specification, specification),
      quantity = COALESCE(@quantity, quantity),
      unit = COALESCE(@unit, unit),
      notes = COALESCE(@notes, notes)
    WHERE id = @id AND pr_id = @prId
  `);
  const deleteLineItemStmt = db.prepare(`
    DELETE FROM pr_line_items WHERE id = ? AND pr_id = ?
  `);

  // Shortlist
  const insertShortlistStmt = db.prepare(`
    INSERT INTO pr_vendor_shortlist (pr_id, vendor_id, line_item_id, reference_price, notes, created_at)
    VALUES (@prId, @vendorId, @lineItemId, @referencePrice, @notes, @now)
  `);
  const selectShortlist = db.prepare(`
    SELECT * FROM pr_vendor_shortlist WHERE pr_id = ? ORDER BY id ASC
  `);
  const deleteShortlistByPr = db.prepare(`
    DELETE FROM pr_vendor_shortlist WHERE pr_id = ?
  `);

  const insertShortlistTx = db.transaction((prId, entries, ts) => {
    deleteShortlistByPr.run(prId);
    const out = [];
    for (const e of entries) {
      const info = insertShortlistStmt.run({
        prId,
        vendorId: e.vendorId,
        lineItemId: e.lineItemId ?? null,
        referencePrice: e.referencePrice ?? null,
        notes: e.notes ?? null,
        now: ts,
      });
      out.push({
        id: Number(info.lastInsertRowid),
        prId,
        vendorId: e.vendorId,
        lineItemId: e.lineItemId ?? null,
        referencePrice: e.referencePrice ?? null,
        notes: e.notes ?? null,
        createdAt: ts,
      });
    }
    return out;
  });

  const insertPrWithItemsTx = db.transaction((params, items, ts) => {
    insertPrStmt.run({ ...params, now: ts });
    for (const item of items) {
      insertLineItemStmt.run({
        prId: params.id,
        materialName: item.materialName,
        specification: item.specification ?? null,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes ?? null,
        now: ts,
      });
    }
  });

  const now = () => Date.now();

  return {
    insert(title, requestedBy, deadline, notes) {
      const id = randomUUID();
      const ts = now();
      insertPrStmt.run({
        id, title, status: "draft",
        requestedBy: requestedBy ?? null,
        deadline: deadline ?? null,
        notes: notes ?? null,
        now: ts,
      });
      return rowToPr(selectPrById.get(id));
    },
    insertWithItems(title, requestedBy, deadline, notes, items) {
      const id = randomUUID();
      const ts = now();
      insertPrWithItemsTx({
        id, title, status: "draft",
        requestedBy: requestedBy ?? null,
        deadline: deadline ?? null,
        notes: notes ?? null,
      }, items || [], ts);
      const pr = rowToPr(selectPrById.get(id));
      pr.lineItems = selectLineItems.all(id).map(rowToLineItem);
      return pr;
    },
    getById(id) {
      if (!id) return null;
      const pr = rowToPr(selectPrById.get(id));
      if (!pr) return null;
      pr.lineItems = selectLineItems.all(id).map(rowToLineItem);
      return pr;
    },
    listAll(status, search, limit = 100) {
      let rows;
      if (status && search) {
        rows = selectPrByStatusAndSearch.all({ status, pattern: `%${search}%`, limit });
      } else if (status) {
        rows = selectPrByStatus.all({ status, limit });
      } else if (search) {
        rows = selectPrSearch.all({ pattern: `%${search}%`, limit });
      } else {
        rows = selectPrAll.all(limit);
      }
      return rows.map(rowToPr);
    },
    updateDraft(id, patch) {
      const info = updateDraftStmt.run({
        id,
        title: patch.title ?? null,
        deadline: patch.deadline ?? null,
        notes: patch.notes ?? null,
        now: now(),
      });
      if (info.changes === 0) return null;
      return rowToPr(selectPrById.get(id));
    },
    addLineItem(prId, item) {
      const ts = now();
      const info = insertLineItemStmt.run({
        prId,
        materialName: item.materialName,
        specification: item.specification ?? null,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes ?? null,
        now: ts,
      });
      return rowToLineItem(selectLineItemById.get(Number(info.lastInsertRowid), prId));
    },
    updateLineItem(prId, itemId, patch) {
      updateLineItemStmt.run({
        id: itemId,
        prId,
        materialName: patch.materialName ?? null,
        specification: patch.specification ?? null,
        quantity: patch.quantity ?? null,
        unit: patch.unit ?? null,
        notes: patch.notes ?? null,
      });
      return rowToLineItem(selectLineItemById.get(itemId, prId));
    },
    removeLineItem(prId, itemId) {
      const info = deleteLineItemStmt.run(itemId, prId);
      return info.changes > 0;
    },
    getLineItems(prId) {
      return selectLineItems.all(prId).map(rowToLineItem);
    },
    transition(id, fromStatus, toStatus, extra = {}) {
      const info = transitionStmt.run({
        id,
        fromStatus,
        toStatus,
        approvedBy: extra.approvedBy ?? null,
        rejectedReason: extra.rejectedReason ?? null,
        sourcingTaskId: extra.sourcingTaskId ?? null,
        analysisTaskId: extra.analysisTaskId ?? null,
        now: now(),
      });
      if (info.changes === 0) return null;
      return rowToPr(selectPrById.get(id));
    },
    insertShortlist(prId, entries) {
      return insertShortlistTx(prId, entries, now());
    },
    getShortlist(prId) {
      return selectShortlist.all(prId).map(rowToShortlistEntry);
    },

    getCompletedHistory({ materialName, vendorId, limit = 50 } = {}) {
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

      const rows = db.prepare(`
        SELECT
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
        LIMIT @limit
      `).all(params);

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
  const insertStmt = db.prepare(`
    INSERT INTO rfq_emails (id, pr_id, vendor_id, to_email, status,
      line_item_ids, created_at, updated_at)
    VALUES (@id, @prId, @vendorId, @toEmail, @status,
      @lineItemIds, @now, @now)
  `);
  const selectById = db.prepare(`SELECT * FROM rfq_emails WHERE id = ?`);
  const selectByPr = db.prepare(`
    SELECT * FROM rfq_emails WHERE pr_id = ? ORDER BY created_at ASC
  `);
  const updateStatusStmt = db.prepare(`
    UPDATE rfq_emails SET
      status = @status,
      sent_at = COALESCE(@sentAt, sent_at),
      delivered_at = COALESCE(@deliveredAt, delivered_at),
      opened_at = COALESCE(@openedAt, opened_at),
      replied_at = COALESCE(@repliedAt, replied_at),
      updated_at = @now
    WHERE id = @id
  `);
  const updateGmailIdsStmt = db.prepare(`
    UPDATE rfq_emails SET
      gmail_thread_id = @gmailThreadId,
      gmail_message_id = @gmailMessageId,
      updated_at = @now
    WHERE id = @id
  `);
  const selectPending = db.prepare(`
    SELECT * FROM rfq_emails WHERE status = 'pending' ORDER BY created_at ASC
  `);
  const selectByStatus = db.prepare(`
    SELECT * FROM rfq_emails WHERE status = ? ORDER BY created_at ASC
  `);

  const now = () => Date.now();

  return {
    insert({ prId, vendorId, toEmail, lineItemIds }) {
      const id = randomUUID();
      insertStmt.run({
        id, prId, vendorId, toEmail,
        status: "pending",
        lineItemIds: lineItemIds ? JSON.stringify(lineItemIds) : null,
        now: now(),
      });
      return rowToRfq(selectById.get(id));
    },
    getById(id) {
      if (!id) return null;
      return rowToRfq(selectById.get(id));
    },
    listByPr(prId) {
      return selectByPr.all(prId).map(rowToRfq);
    },
    updateStatus(id, status, metadata = {}) {
      updateStatusStmt.run({
        id, status,
        sentAt: metadata.sentAt ?? null,
        deliveredAt: metadata.deliveredAt ?? null,
        openedAt: metadata.openedAt ?? null,
        repliedAt: metadata.repliedAt ?? null,
        now: now(),
      });
      return rowToRfq(selectById.get(id));
    },
    updateGmailIds(id, gmailThreadId, gmailMessageId) {
      updateGmailIdsStmt.run({
        id,
        gmailThreadId: gmailThreadId ?? null,
        gmailMessageId: gmailMessageId ?? null,
        now: now(),
      });
      return rowToRfq(selectById.get(id));
    },
    listPending() {
      return selectPending.all().map(rowToRfq);
    },
    listByStatus(status) {
      return selectByStatus.all(status).map(rowToRfq);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Vendor Responses Repository
   ═══════════════════════════════════════════════════════ */

export const createVendorResponsesRepository = (db) => {
  const insertStmt = db.prepare(`
    INSERT INTO vendor_responses (rfq_id, pr_id, vendor_id, line_item_id,
      unit_price, total_price, lead_time_days, min_order_qty, availability,
      currency, valid_until, raw_text, parsed_at, created_at)
    VALUES (@rfqId, @prId, @vendorId, @lineItemId,
      @unitPrice, @totalPrice, @leadTimeDays, @minOrderQty, @availability,
      @currency, @validUntil, @rawText, @parsedAt, @now)
  `);
  const selectByPr = db.prepare(`
    SELECT * FROM vendor_responses WHERE pr_id = ? ORDER BY created_at ASC
  `);
  const selectByRfq = db.prepare(`
    SELECT * FROM vendor_responses WHERE rfq_id = ? ORDER BY created_at ASC
  `);

  const now = () => Date.now();

  return {
    insert(data) {
      const ts = now();
      const info = insertStmt.run({
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
      });
      return {
        id: Number(info.lastInsertRowid),
        ...data,
        parsedAt: data.parsedAt ?? ts,
        createdAt: ts,
      };
    },
    listByPr(prId) {
      return selectByPr.all(prId).map(rowToVendorResponse);
    },
    listByRfq(rfqId) {
      return selectByRfq.all(rfqId).map(rowToVendorResponse);
    },
    listByVendor(vendorId) {
      return db.prepare(`
        SELECT * FROM vendor_responses WHERE vendor_id = ? ORDER BY created_at ASC
      `).all(vendorId).map(rowToVendorResponse);
    },
    listCompetitorsForLineItem(prId, lineItemId) {
      return db.prepare(`
        SELECT * FROM vendor_responses
        WHERE pr_id = ? AND line_item_id = ? AND unit_price IS NOT NULL
      `).all(prId, lineItemId).map(rowToVendorResponse);
    },
  };
};

/* ═══════════════════════════════════════════════════════
   Status Log Repository
   ═══════════════════════════════════════════════════════ */

export const createStatusLogRepository = (db) => {
  const insertStmt = db.prepare(`
    INSERT INTO pr_status_log (pr_id, from_status, to_status, changed_by, reason, created_at)
    VALUES (@prId, @fromStatus, @toStatus, @changedBy, @reason, @now)
  `);
  const selectByPr = db.prepare(`
    SELECT * FROM pr_status_log WHERE pr_id = ? ORDER BY created_at ASC, id ASC
  `);

  const now = () => Date.now();

  return {
    insert(prId, fromStatus, toStatus, changedBy, reason) {
      const ts = now();
      const info = insertStmt.run({
        prId,
        fromStatus: fromStatus ?? null,
        toStatus,
        changedBy: changedBy ?? null,
        reason: reason ?? null,
        now: ts,
      });
      return {
        id: Number(info.lastInsertRowid),
        prId,
        fromStatus: fromStatus ?? null,
        toStatus,
        changedBy: changedBy ?? null,
        reason: reason ?? null,
        createdAt: ts,
      };
    },
    listByPr(prId) {
      return selectByPr.all(prId).map(rowToStatusLog);
    },
  };
};
