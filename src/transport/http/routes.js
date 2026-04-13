import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { runExternalChecks } from "../../core/external-checks.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/service.js";
import { SIGNATURE_HEADER, verifySignature } from "../../webhook/signer.js";

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

export const createRoutes = ({
  service,
  sse,
  webhookSecret,
  publicConfig = {},
  projectRoot = null,
  repo = null,
  health = null,
  externalChecks = [],
  mcpHandler = null,
}) => {
  const router = express.Router();

  if (mcpHandler) {
    const mcpJson = express.json({ limit: JSON_LIMIT });
    const wrapped = async (req, res) => {
      try {
        await mcpHandler(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error in MCP transport: " + err.message },
            id: null,
          });
        }
      }
    };
    router.post("/mcp", mcpJson, wrapped);
    router.get("/mcp", wrapped);
    router.delete("/mcp", wrapped);
  }

  router.get("/api/health", async (req, res) => {
    if (!health) {
      return res.status(503).json({ ok: false, error: "health tracker not configured" });
    }
    const snap = health.snapshot({
      repo,
      sseSize: sse?.size?.() ?? null,
      version: publicConfig.version ?? null,
    });
    if (externalChecks.length > 0) {
      snap.external = await runExternalChecks({
        checks: externalChecks,
        mcpStatus: snap.mcp?.status,
      });
    } else {
      snap.external = [];
    }
    return res.status(snap.ok ? 200 : 503).json(snap);
  });

  router.get("/api/config", (req, res) => {
    res.json({
      agentId: publicConfig.agentId ?? null,
      webhookUrl: publicConfig.webhookUrl ?? null,
      webHost: publicConfig.webHost ?? null,
      webPort: publicConfig.webPort ?? null,
      version: publicConfig.version ?? null,
    });
  });

  router.get("/api/changelog", async (req, res) => {
    if (!projectRoot) {
      return res.status(404).type("text/plain").send("# Changelog\n\nNot configured on this server.\n");
    }
    try {
      const md = await fs.readFile(path.join(projectRoot, "CHANGELOG.md"), "utf8");
      res.type("text/markdown; charset=utf-8").send(md);
    } catch {
      res.status(404).type("text/plain").send("# Changelog\n\nCHANGELOG.md not found.\n");
    }
  });

  router.post("/api/tasks", express.json({ limit: JSON_LIMIT }), async (req, res) => {
    try {
      const task = await service.create(req.body?.prompt);
      return res.status(201).json(task);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks", (req, res) => {
    const limit = Number(req.query.limit) || undefined;
    const includeArchived = req.query.include_archived === "true" || req.query.include_archived === "1";
    return res.json({ tasks: service.listAll(limit, { includeArchived }) });
  });

  router.get("/api/tasks/:id", (req, res) => {
    try {
      return res.json(service.get(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.patch("/api/tasks/:id", express.json({ limit: JSON_LIMIT }), async (req, res) => {
    try {
      const updated = await service.updatePrompt(req.params.id, req.body?.prompt);
      return res.json(updated);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/tasks/:id/archive", async (req, res) => {
    try {
      const archived = await service.archive(req.params.id);
      return res.json(archived);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post("/api/tasks/:id/unarchive", async (req, res) => {
    try {
      const unarchived = await service.unarchive(req.params.id);
      return res.json(unarchived);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.delete("/api/tasks/:id", async (req, res) => {
    try {
      const result = await service.delete(req.params.id);
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/events", (req, res) => {
    sse.attach(res);
  });

  router.post(
    "/webhooks/task-events",
    express.raw({ type: "application/json", limit: JSON_LIMIT }),
    (req, res) => {
      const signature = req.headers[SIGNATURE_HEADER];
      const raw = req.body;
      if (!Buffer.isBuffer(raw) || raw.length === 0) {
        health?.recordWebhookRejected();
        return res.status(400).json({ error: "empty body" });
      }
      const rawString = raw.toString("utf8");
      if (!verifySignature(webhookSecret, rawString, signature)) {
        health?.recordWebhookRejected();
        return res.status(401).json({ error: "invalid signature" });
      }

      let parsed;
      try {
        parsed = JSON.parse(rawString);
      } catch {
        health?.recordWebhookRejected();
        return res.status(400).json({ error: "invalid json" });
      }

      const { event, data } = parsed ?? {};
      if (!event || !data) {
        health?.recordWebhookRejected();
        return res.status(400).json({ error: "event and data are required" });
      }

      sse.broadcast(event, data);
      health?.recordWebhookOk();
      return res.status(200).json({ ok: true });
    }
  );

  return router;
};
