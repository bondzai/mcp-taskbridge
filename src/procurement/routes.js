import express from "express";
import { ValidationError, NotFoundError, ConflictError } from "../core/service.js";

const JSON_LIMIT = "1mb";

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

export const createProcurementRoutes = ({ service }) => {
  const router = express.Router();
  const json = express.json({ limit: JSON_LIMIT });

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
