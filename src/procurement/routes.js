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

  router.get("/api/procurement/prs", (req, res) => {
    try {
      const { status, search, limit } = req.query;
      const prs = service.listPrs({
        status: status || undefined,
        search: search || undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ purchaseRequests: prs });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id", (req, res) => {
    try {
      return res.json(service.getPr(req.params.id));
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

  router.get("/api/procurement/prs/:id/comparison", (req, res) => {
    try {
      return res.json(service.getComparison(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/prs/:id/timeline", (req, res) => {
    try {
      const timeline = service.getTimeline(req.params.id);
      return res.json({ timeline });
    } catch (err) {
      return sendError(res, err);
    }
  });

  /* ═══════ Purchase History ═══════ */

  router.get("/api/procurement/history", (req, res) => {
    try {
      const { material, vendor_id, limit } = req.query;
      const history = service.getPurchaseHistory({
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

  router.get("/api/procurement/vendors", (req, res) => {
    try {
      const { q, category, active, limit } = req.query;
      let vendors;
      if (q || category) {
        vendors = service.searchVendors(q, category, limit ? Number(limit) : undefined);
      } else {
        vendors = service.listVendors({
          active: active === "true" ? true : active === "false" ? false : undefined,
          limit: limit ? Number(limit) : undefined,
        });
      }
      return res.json({ vendors });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors", json, (req, res) => {
    try {
      const vendor = service.createVendor(req.body ?? {});
      return res.status(201).json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/vendors/:id", (req, res) => {
    try {
      return res.json(service.getVendor(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/procurement/vendors/:id/kpis", (req, res) => {
    try {
      const kpis = service.getVendorKpis(req.params.id);
      return res.json(kpis);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/vendors/:id", json, (req, res) => {
    try {
      const updated = service.updateVendor(req.params.id, req.body ?? {});
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/materials", json, (req, res) => {
    try {
      const material = service.addVendorMaterial(req.params.id, req.body ?? {});
      return res.status(201).json(material);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/procurement/vendors/:id/materials/:mid", json, (req, res) => {
    try {
      const material = service.updateVendorMaterial(
        req.params.id,
        Number(req.params.mid),
        req.body ?? {}
      );
      return res.json(material);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete("/api/procurement/vendors/:id/materials/:mid", (req, res) => {
    try {
      const result = service.deleteVendorMaterial(req.params.id, Number(req.params.mid));
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/import", json, (req, res) => {
    try {
      const { vendors: vendorList } = req.body ?? {};
      const results = service.importVendors(vendorList);
      return res.status(201).json({ imported: results.length, vendors: results });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/deactivate", (req, res) => {
    try {
      const vendor = service.deactivateVendor(req.params.id);
      return res.json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/procurement/vendors/:id/activate", (req, res) => {
    try {
      const vendor = service.activateVendor(req.params.id);
      return res.json(vendor);
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
};
