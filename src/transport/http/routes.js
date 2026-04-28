import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { runExternalChecks } from "../../core/external-checks.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/service.js";
import { SIGNATURE_HEADER, verifySignature } from "../../webhook/signer.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    cb(null, ["application/pdf", "text/plain"].includes(file.mimetype));
  },
});

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
  mcpHandlerForAdapter = null,
}) => {
  const router = express.Router();

  /**
   * Validate a `:agentId` path segment for /mcp/<agentId>.
   * Allows lowercase + digits + dash + underscore, length 1..64.
   * Anything else is rejected with 400 to keep the URL space clean
   * and prevent path traversal / weird routing collisions.
   */
  const sanitizeAgentId = (raw) => {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)) return null;
    return trimmed;
  };

  if (mcpHandler) {
    const mcpJson = express.json({ limit: JSON_LIMIT });
    const wrapped = async (req, res) => {
      // Trace EVERY /mcp request so future "why was this tagged X?"
      // questions are answerable from the web server's stderr alone.
      try {
        const body = req.body;
        const bodyMethod = Array.isArray(body)
          ? body.map((m) => m?.method).filter(Boolean).join(",")
          : body?.method || null;
        const clientName = Array.isArray(body)
          ? (body.find((m) => m?.method === "initialize")?.params?.clientInfo?.name)
          : (body?.method === "initialize" ? body?.params?.clientInfo?.name : null);
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          msg: "mcp request",
          meta: {
            httpMethod: req.method,
            bodyMethod,
            clientName: clientName || null,
            ua: req.headers["user-agent"] || null,
            ip: req.ip || req.socket?.remoteAddress || null,
            contentType: req.headers["content-type"] || null,
          },
        }) + "\n");
      } catch { /* never let logging break the request */ }

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

    /**
     * Per-URL routing — `/mcp/<agentId>` is the explicit, dynamic
     * way to label a client without prompt-level hardcoding or
     * environment variables. The :agentId path segment is taken
     * verbatim as the adapter id.
     *
     * Each request builds a fresh handler bound to that fixed
     * adapter id (no clientTracker involvement).
     */
    if (mcpHandlerForAdapter) {
      const wrappedAdapter = async (req, res) => {
        const agentId = sanitizeAgentId(req.params.agentId);
        if (!agentId) {
          return res.status(400).json({
            jsonrpc: "2.0",
            id: req.body?.id ?? null,
            error: {
              code: -32602,
              message: "invalid agentId path segment — must be 1-64 chars of [a-z0-9_-]",
            },
          });
        }
        try {
          const adapterHandler = mcpHandlerForAdapter(agentId);
          await adapterHandler(req, res);
        } catch (err) {
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              id: req.body?.id ?? null,
              error: { code: -32603, message: "Internal error: " + err.message },
            });
          }
        }
      };
      router.post("/mcp/:agentId", mcpJson, wrappedAdapter);
      router.get("/mcp/:agentId", wrappedAdapter);
      router.delete("/mcp/:agentId", wrappedAdapter);
    }
  }

  router.get("/api/health", async (req, res) => {
    if (!health) {
      return res.status(503).json({ ok: false, error: "health tracker not configured" });
    }
    const snap = await health.snapshot({
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

  const parseTaskBody = (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("multipart/form-data")) {
      upload.array("files", 5)(req, res, (err) => {
        if (err) return sendError(res, new ValidationError(err.message));
        next();
      });
    } else {
      express.json({ limit: JSON_LIMIT })(req, res, next);
    }
  };

  router.post("/api/tasks", parseTaskBody, async (req, res) => {
    try {
      const files = (req.files || []).map((f) => ({
        filename: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        content: f.buffer,
      }));
      const task = await service.create(req.body?.prompt, files.length > 0 ? files : undefined);
      return res.status(201).json(task);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks", async (req, res) => {
    const limit = Number(req.query.limit) || undefined;
    const includeArchived = req.query.include_archived === "true" || req.query.include_archived === "1";
    return res.json({ tasks: await service.listAll(limit, { includeArchived }) });
  });

  router.get("/api/tasks/:id", async (req, res) => {
    try {
      return res.json(await service.get(req.params.id));
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks/:id/progress", async (req, res) => {
    try {
      const entries = await service.getProgressLog(req.params.id);
      return res.json({ entries });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks/:id/attachments", async (req, res) => {
    try {
      return res.json({ attachments: await service.getAttachments(req.params.id) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks/:id/attachments/:aid", async (req, res) => {
    try {
      const att = await service.getAttachmentContent(req.params.id, Number(req.params.aid));
      res.set("Content-Type", att.mimeType);
      res.set("Content-Disposition", `attachment; filename="${att.filename}"`);
      res.set("Content-Length", String(att.size));
      return res.send(att.content);
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.get("/api/tasks/:id/attachments/:aid/text", async (req, res) => {
    try {
      const att = await service.getAttachmentContent(req.params.id, Number(req.params.aid));
      let text;
      if (att.mimeType === "text/plain") {
        text = att.content.toString("utf8");
      } else if (att.mimeType === "application/pdf") {
        const pdfParse = (await import("pdf-parse")).default;
        text = (await pdfParse(att.content)).text;
      } else {
        throw new ValidationError(`unsupported type for text extraction: ${att.mimeType}`);
      }
      return res.type("text/plain").send(text);
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
