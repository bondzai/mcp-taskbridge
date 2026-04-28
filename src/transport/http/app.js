import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHealthTracker } from "../../core/health.js";
import { createHttpMcpHandler } from "../mcp/server.js";
import { createRoutes } from "./routes.js";
import { createSseBroadcaster } from "./sse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");

export const createApp = ({
  service,
  webhookSecret,
  events,
  sse = createSseBroadcaster(),
  publicConfig = {},
  projectRoot = null,
  repo = null,
  health = createHealthTracker({ events }),
  externalChecks = [],
  mcpHandler = null,
  procurementRoutes = null,
  authMiddleware = null,
  authRoutes = null,
}) => {
  if (!service) throw new Error("service is required");
  if (!webhookSecret) throw new Error("webhookSecret is required");

  if (events) {
    events.subscribe((event, data) => sse.broadcast(event, data));
  }

  // Factory used by /mcp/:agentId — builds a fresh handler bound to a
  // specific adapter id taken straight from the URL path. No detection,
  // no clientTracker.
  const mcpHandlerForAdapter = mcpHandler
    ? (adapterId) => createHttpMcpHandler({ service, fixedAdapterId: adapterId })
    : null;

  const app = express();
  app.disable("x-powered-by");

  // Cookie parsing is needed before auth middleware can read tb_session.
  app.use(cookieParser());

  // Static assets are served before auth so login.html + CSS/JS are reachable.
  app.use(express.static(publicDir));

  // Auth routes (login/logout/me) are mounted before the guard so
  // /api/auth/login is always reachable.
  if (authRoutes) {
    app.use(authRoutes);
  }

  // Auth middleware — gates everything that isn't public.
  if (authMiddleware) {
    app.use(authMiddleware);
  }

  app.use(createRoutes({
    service, sse, webhookSecret, publicConfig, projectRoot, repo, health, externalChecks,
    mcpHandler, mcpHandlerForAdapter,
  }));

  if (procurementRoutes) {
    app.use(procurementRoutes);
  }

  return { app, sse, health };
};
