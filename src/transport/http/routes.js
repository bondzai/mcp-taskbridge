import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
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
}) => {
  const router = express.Router();

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
    return res.json({ tasks: service.listAll(limit) });
  });

  router.get("/api/tasks/:id", (req, res) => {
    try {
      return res.json(service.get(req.params.id));
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
        return res.status(400).json({ error: "empty body" });
      }
      const rawString = raw.toString("utf8");
      if (!verifySignature(webhookSecret, rawString, signature)) {
        return res.status(401).json({ error: "invalid signature" });
      }

      let parsed;
      try {
        parsed = JSON.parse(rawString);
      } catch {
        return res.status(400).json({ error: "invalid json" });
      }

      const { event, data } = parsed ?? {};
      if (!event || !data) {
        return res.status(400).json({ error: "event and data are required" });
      }

      sse.broadcast(event, data);
      return res.status(200).json({ ok: true });
    }
  );

  return router;
};
