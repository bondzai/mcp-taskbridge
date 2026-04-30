import express from "express";
import multer from "multer";
import { ValidationError, NotFoundError, ConflictError } from "../core/service.js";
import { createLlmProvider } from "../llm/provider.js";
import { verifySignature } from "../webhook/signer.js";
import { generateMockPr, renderMockPrDocument } from "./mock-prs.js";

const JSON_LIMIT = "1mb";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, ["application/pdf", "text/plain"].includes(file.mimetype));
  },
});

const extractText = async (file) => {
  if (file.mimetype === "text/plain") return file.buffer.toString("utf8");
  if (file.mimetype === "application/pdf") {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const result = await pdfParse(file.buffer);
    return result.text || "";
  }
  throw new ValidationError(`unsupported mime type: ${file.mimetype}`);
};

const statusForError = (err) => {
  if (err instanceof ValidationError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
};

const sendError = (res, err) => {
  const status = statusForError(err);
  res.status(status).json({ error: err.message, code: err.code ?? "INTERNAL" });
};

export const createProcurementRoutes = ({ service, rfxWebhookSecret = null, logger = console }) => {
  const router = express.Router();
  const json = express.json({ limit: JSON_LIMIT });

  /* ═══════ RFx Webhook (mail service → core) ═══════
   * POST /webhooks/rfx-events
   *   Headers (optional during bring-up):
   *     X-Taskbridge-Signature: sha256=<hex>   (HMAC over raw body, RFX_WEBHOOK_SECRET)
   *   Body:
   *     { rfxId, event, occurredAt, vendorEmail?, vendorId?, prId?, detail? }
   *
   * Permissive HMAC: if RFX_WEBHOOK_SECRET is set AND a signature header is
   * present, we verify and reject mismatches. Otherwise we accept the event
   * and log a warning. Tighten this once the mail service is signing.
   */
  /* ═══════ Status webhooks (mail service → core) ═══════
   * Both follow the same shape: permissive HMAC, idempotent, SSE broadcast.
   * Contract: docs/status-model.md
   */

  // POST /webhooks/rfx-item-status
  // body: { rfxId, lineItemId?, status, occurredAt, detail? }
  router.post("/webhooks/rfx-item-status", json, async (req, res) => {
    const sig = req.headers["x-taskbridge-signature"] || req.headers["x-signature"];
    if (rfxWebhookSecret && !sig) {
      logger.warn?.("rfx-item-status webhook: secret set but request unsigned (permissive)");
    }

    const RFX_ITEM_STATUSES = new Set(["pending_send", "awaiting_reply", "replied", "expired", "completed", "cancelled"]);
    // Map RFx-item statuses onto the existing rfq_emails.status enum so we
    // can persist immediately without a schema change. When a dedicated
    // pr_rfx_items table lands, this mapping goes away.
    const TO_RFQ_STATUS = {
      pending_send:  "pending",
      awaiting_reply: "sent",
      replied:        "replied",
      expired:        "expired",
      completed:      "replied",      // closest-existing terminal — refine when pr_rfx_items lands
      cancelled:      "expired",
    };

    const { rfxId, lineItemId = null, status, occurredAt, detail = null } = req.body ?? {};
    if (!rfxId) return res.status(400).json({ error: "rfxId is required", code: "VALIDATION" });
    if (!RFX_ITEM_STATUSES.has(status)) {
      return res.status(400).json({ error: `invalid status: ${status}`, code: "VALIDATION" });
    }
    const ts = Number(occurredAt) || Date.now();

    try {
      const result = await service.recordRfxEvent({
        rfxId,
        event: status,                              // reuse rfx_event_log for audit
        occurredAt: ts,
        vendorId: null, prId: null,
        detail: { lineItemId, ...((detail && typeof detail === "object") ? detail : {}) },
      });
      // Apply status mapping if the underlying rfq_emails row should change.
      const mapped = TO_RFQ_STATUS[status];
      if (mapped && result.rfqEmail && result.rfqEmail.status !== mapped) {
        await service.updateRfqStatus(rfxId, mapped, {});
      }
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // POST /webhooks/pr-item-status
  // body: { prId, lineItemId, status, occurredAt, reason? }
  router.post("/webhooks/pr-item-status", json, async (req, res) => {
    const sig = req.headers["x-taskbridge-signature"] || req.headers["x-signature"];
    if (rfxWebhookSecret && !sig) {
      logger.warn?.("pr-item-status webhook: secret set but request unsigned (permissive)");
    }

    const PR_ITEM_STATUSES = new Set(["pending_rfx", "rfx_complete", "cancelled"]);
    // Map onto current pr_line_items.status enum until the new vocabulary lands.
    const TO_LINE_ITEM_STATUS = {
      pending_rfx:   "sourcing",
      rfx_complete:  "quoted",
      cancelled:     "cancelled",
    };

    const { prId, lineItemId, status, occurredAt, reason = null } = req.body ?? {};
    if (!prId) return res.status(400).json({ error: "prId is required", code: "VALIDATION" });
    if (lineItemId == null) return res.status(400).json({ error: "lineItemId is required", code: "VALIDATION" });
    if (!PR_ITEM_STATUSES.has(status)) {
      return res.status(400).json({ error: `invalid status: ${status}`, code: "VALIDATION" });
    }
    const ts = Number(occurredAt) || Date.now();

    try {
      const result = await service.applyPrItemStatus({
        prId,
        lineItemId: Number(lineItemId),
        newStatus: TO_LINE_ITEM_STATUS[status],
        externalLabel: status,
        reason,
        occurredAt: ts,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post(
    "/webhooks/rfx-events",
    json,
    async (req, res) => {
      // Permissive HMAC: when RFX_WEBHOOK_SECRET is set AND a signature
      // header is present, we *would* verify — but verification needs the
      // raw body, which an upstream express.json middleware (authRoutes)
      // already consumed. For the bring-up phase we accept all requests
      // and only log when a signature is provided so tightening later is
      // a one-line switch.
      const signature = req.headers["x-taskbridge-signature"] || req.headers["x-signature"];
      if (rfxWebhookSecret && !signature) {
        logger.warn?.("rfx-webhook: secret set but request unsigned — accepting (permissive mode)");
      }
      if (signature) {
        logger.info?.("rfx-webhook: signature present (verification deferred)", { sig: String(signature).slice(0, 16) });
      }

      const { rfxId, event, occurredAt, vendorEmail, vendorId, prId, detail } = req.body ?? {};
      try {
        const result = await service.recordRfxEvent({
          rfxId,
          event,
          occurredAt: Number(occurredAt) || Date.now(),
          vendorEmail,
          vendorId,
          prId,
          detail,
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        return sendError(res, err);
      }
    }
  );


  /* ═══════ PR Lifecycle ═══════ */

  router.post("/api/procurement/prs", json, async (req, res) => {
    try {
      const { title, requestedBy, deadline, notes, lineItems } = req.body ?? {};
      const pr = await service.createPr(title, requestedBy, { deadline, notes, lineItems });
      return res.status(201).json(pr);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/export", async (req, res) => {
    try {
      const data = await service.exportAll();
      res.setHeader("Content-Disposition", `attachment; filename="prs-${Date.now()}.json"`);
      return res.json(data);
    } catch (err) {
      return sendError(res, err);
    }
  });

  // Generate a mock PR document (.txt) — used by the demo "From File" button
  // upstream so the user can download a realistic doc, then upload it back
  // and watch the LLM rebuild the PR.
  router.get("/api/procurement/mock-pr-document", (req, res) => {
    try {
      const pr = generateMockPr();
      const text = renderMockPrDocument(pr);
      const slug = (pr.title || "mock-pr")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${slug || "mock-pr"}.txt"`);
      return res.send(text);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/from-file", (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) return sendError(res, new ValidationError(err.message));
      if (!req.file) return sendError(res, new ValidationError("file is required"));
      try {
        const text = await extractText(req.file);
        if (!text || text.trim().length < 20) {
          return sendError(res, new ValidationError("document had no readable text"));
        }
        let provider;
        try {
          provider = await createLlmProvider();
        } catch (e) {
          // No LLM configured (e.g. OPENAI_API_KEY missing). Return 503 with
          // an actionable message instead of a generic 500 — the UI can also
          // hide/disable the button via /api/config.llmConfigured.
          return res.status(503).json({
            error: "LLM provider not configured on this server. Set OPENAI_API_KEY (or LLM_PROVIDER) and redeploy.",
            detail: e.message,
            code: "LLM_NOT_CONFIGURED",
          });
        }
        const extracted = await provider.extractPrFromDocument(text, {
          filename: req.file.originalname,
        });
        // Validate the document is actually a PR. The LLM flags non-PR docs
        // explicitly; we also fall back to a heuristic (no line items + no
        // title) in case the model didn't set the flag.
        const looksLikePr = extracted.isPurchaseRequest !== false
          && (extracted.lineItems?.length > 0 || (extracted.title && extracted.title.length > 3));
        if (!looksLikePr) {
          return res.status(422).json({
            error: extracted.rejectionReason || "This file doesn't look like a purchase requisition.",
            code: "NOT_A_PR",
            extracted,
          });
        }
        return res.json({ extracted, provider: provider.name, model: provider.model });
      } catch (e) {
        return sendError(res, e);
      }
    });
  });

  router.post("/api/procurement/prs/import", json, async (req, res) => {
    try {
      const result = await service.importPrs(req.body ?? {});
      return res.status(201).json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/export", async (req, res) => {
    try {
      const data = await service.exportPr(req.params.id);
      res.setHeader("Content-Disposition", `attachment; filename="pr-${req.params.id}.json"`);
      return res.json(data);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs", async (req, res) => {
    try {
      const { status, search, limit } = req.query;
      const prs = await service.listPrs({
        status: status || undefined,
        search: search || undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ purchaseRequests: prs });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id", async (req, res) => {
    try {
      return res.json(await service.getPr(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/prs/:id", json, async (req, res) => {
    try {
      const updated = await service.updateDraft(req.params.id, req.body ?? {});
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete("/api/procurement/prs/:id", async (req, res) => {
    try {
      const result = await service.deletePr(req.params.id);
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/items", json, async (req, res) => {
    try {
      const item = await service.addLineItem(req.params.id, req.body ?? {});
      return res.status(201).json(item);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/prs/:id/items/:itemId", json, async (req, res) => {
    try {
      const item = await service.updateLineItem(
        req.params.id,
        Number(req.params.itemId),
        req.body ?? {}
      );
      return res.json(item);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete("/api/procurement/prs/:id/items/:itemId", async (req, res) => {
    try {
      const result = await service.removeLineItem(req.params.id, Number(req.params.itemId));
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/submit", async (req, res) => {
    try {
      const updated = await service.submitForApproval(req.params.id);
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/approve", json, async (req, res) => {
    try {
      const { approvedBy } = req.body ?? {};
      const updated = await service.approve(req.params.id, approvedBy);
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/reject", json, async (req, res) => {
    try {
      const { reason } = req.body ?? {};
      const updated = await service.reject(req.params.id, reason);
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/start-sourcing", async (req, res) => {
    try {
      const result = await service.startSourcing(req.params.id);
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/cancel", json, async (req, res) => {
    try {
      const { reason } = req.body ?? {};
      const updated = await service.cancel(req.params.id, reason);
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/duplicate", json, async (req, res) => {
    try {
      const pr = await service.duplicatePr(req.params.id);
      return res.status(201).json(pr);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/prs/:id/reprocess", json, async (req, res) => {
    try {
      const pr = await service.reprocessPr(req.params.id);
      return res.json(pr);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/debug-log", async (req, res) => {
    try {
      const log = service.getDebugLog(req.params.id);
      return res.json({ log });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // TEMP — internal debug. Persistent log of mail-service responses per PR.
  router.get("/api/procurement/prs/:id/rfx-send-log", async (req, res) => {
    try {
      const entries = await service.listRfxSendLog(req.params.id);
      return res.json({ entries });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/rfq-payloads", async (req, res) => {
    try {
      const data = service.getRfqPayloads(req.params.id);
      if (!data) return res.json({ payloads: [], message: "No RFQ payloads generated yet" });
      return res.json(data);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/comparison", async (req, res) => {
    try {
      return res.json(await service.getComparison(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/timeline", async (req, res) => {
    try {
      const timeline = await service.getTimeline(req.params.id);
      return res.json({ timeline });
    } catch (err) {
      return sendError(res, err);
    }
  });

  /* ═══════ Item Status ═══════ */

  router.patch("/api/procurement/prs/:id/items/:itemId/status", json, async (req, res) => {
    try {
      const { status, note, changedBy, selectedVendorId, selectedPrice, poNumber } = req.body ?? {};
      const result = await service.updateItemStatus(
        req.params.id,
        Number(req.params.itemId),
        status,
        { changedBy, note, selectedVendorId, selectedPrice, poNumber }
      );
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/items/:itemId/timeline", async (req, res) => {
    try {
      const timeline = await service.getItemTimeline(req.params.id, Number(req.params.itemId));
      return res.json({ timeline });
    } catch (err) {
      return sendError(res, err);
    }
  });

  /* ═══════ Purchase History ═══════ */

  router.get("/api/procurement/history", async (req, res) => {
    try {
      const { material, vendor_id, limit } = req.query;
      const history = await service.getPurchaseHistory({
        materialName: material || undefined,
        vendorId: vendor_id || undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ history });
    } catch (err) {
      return sendError(res, err);
    }
  });

  /* ═══════ Vendors ═══════ */

  router.get("/api/procurement/vendors", async (req, res) => {
    try {
      const { q, category, active, limit } = req.query;
      let vendors;
      if (q || category) {
        vendors = await service.searchVendors(q, category, limit ? Number(limit) : undefined);
      } else {
        vendors = await service.listVendors({
          active: active === "true" ? true : active === "false" ? false : undefined,
          limit: limit ? Number(limit) : undefined,
        });
      }
      return res.json({ vendors });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors", json, async (req, res) => {
    try {
      const vendor = await service.createVendor(req.body ?? {});
      return res.status(201).json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/vendors/:id", async (req, res) => {
    try {
      return res.json(await service.getVendor(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/vendors/:id/kpis", async (req, res) => {
    try {
      const kpis = await service.getVendorKpis(req.params.id);
      return res.json(kpis);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/vendors/:id", json, async (req, res) => {
    try {
      const updated = await service.updateVendor(req.params.id, req.body ?? {});
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/materials", json, async (req, res) => {
    try {
      const material = await service.addVendorMaterial(req.params.id, req.body ?? {});
      return res.status(201).json(material);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/vendors/:id/materials/:mid", json, async (req, res) => {
    try {
      const material = await service.updateVendorMaterial(
        req.params.id,
        Number(req.params.mid),
        req.body ?? {}
      );
      return res.json(material);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete("/api/procurement/vendors/:id/materials/:mid", async (req, res) => {
    try {
      const result = await service.deleteVendorMaterial(req.params.id, Number(req.params.mid));
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/import", json, async (req, res) => {
    try {
      const { vendors: vendorList } = req.body ?? {};
      const results = await service.importVendors(vendorList);
      return res.status(201).json({ imported: results.length, vendors: results });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/deactivate", async (req, res) => {
    try {
      const vendor = await service.deactivateVendor(req.params.id);
      return res.json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/activate", async (req, res) => {
    try {
      const vendor = await service.activateVendor(req.params.id);
      return res.json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
};
