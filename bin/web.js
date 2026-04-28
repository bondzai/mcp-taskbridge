#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { createClientTracker } from "../src/core/client-detection.js";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { DEFAULT_CHECKS } from "../src/core/external-checks.js";
import { createTasksRepository, createAttachmentsRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { logger } from "../src/logger.js";
import { createApp } from "../src/transport/http/app.js";
import { createHttpMcpHandler } from "../src/transport/mcp/server.js";
import { procurementConfig } from "../src/procurement/config.js";
import {
  createVendorsRepository,
  createPurchaseRequestsRepository,
  createRfqRepository,
  createVendorResponsesRepository,
  createStatusLogRepository,
} from "../src/procurement/repo.js";
import { createProcurementService } from "../src/procurement/service.js";
import { createProcurementToolHandlers, procurementToolDefinitions } from "../src/procurement/tools.js";
import { createProcurementRoutes } from "../src/procurement/routes.js";
import { evaluateShortlist } from "../src/procurement/decision-engine.js";
import { ProcurementEvents } from "../src/procurement/events.js";
import { createAuthMiddleware } from "../src/auth/middleware.js";
import { createAuthRoutes } from "../src/auth/routes.js";

const readPackageVersion = () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return null;
  }
};

const main = async () => {
  const db = openDatabase(config.dbPath);
  const repo = createTasksRepository(db);
  const attachmentsRepo = createAttachmentsRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events, attachmentsRepo });

  // ─── Procurement ───
  let extraTools = [];
  let procurementRoutes = null;

  if (procurementConfig.enabled) {
    const procRepos = {
      vendors: createVendorsRepository(db),
      purchaseRequests: createPurchaseRequestsRepository(db),
      rfq: createRfqRepository(db),
      vendorResponses: createVendorResponsesRepository(db),
      statusLog: createStatusLogRepository(db),
    };

    const procService = createProcurementService({
      repos: procRepos,
      events,
      taskService: service,
    });

    const procHandlers = createProcurementToolHandlers({ service: procService });
    extraTools = procurementToolDefinitions(procHandlers);
    procurementRoutes = createProcurementRoutes({ service: procService });

    // Wire event: on pr.sourced → run decision engine → create RFQ emails
    events.subscribe(async (event, data) => {
      if (event !== ProcurementEvents.PR_SOURCED) return;
      try {
        const pr = procService.getPr(data.id);
        const shortlist = pr.shortlist || [];
        const lineItems = pr.lineItems || [];
        const vendorIds = [...new Set(shortlist.map((s) => s.vendorId))];
        const vendors = vendorIds.map((id) => procRepos.vendors.getById(id)).filter(Boolean);

        const result = evaluateShortlist({ shortlist, lineItems, vendors });
        if (result.valid && result.rfqPlan.length > 0) {
          await procService.createRfqEmails(data.id, result.rfqPlan);
          logger.info("decision engine: RFQ emails created", {
            prId: data.id,
            rfqCount: result.rfqPlan.length,
            warnings: result.warnings,
          });
        } else {
          logger.warn("decision engine: shortlist validation failed", {
            prId: data.id,
            errors: result.errors,
            warnings: result.warnings,
          });
        }
      } catch (err) {
        logger.error("decision engine error", { prId: data.id, error: err.message });
      }
    });

    logger.info("procurement module enabled");
  }

  const version = readPackageVersion();
  const clientTracker = createClientTracker({ fallback: config.agentId, logger });
  const mcpHandler = createHttpMcpHandler({
    service,
    clientTracker,
    version: version ?? "0.0.0",
    extraTools,
  });

  const authMiddleware = createAuthMiddleware();
  const authRoutes = createAuthRoutes();

  const { app } = createApp({
    service,
    webhookSecret: config.webhookSecret,
    events,
    repo,
    projectRoot: config.projectRoot,
    externalChecks: DEFAULT_CHECKS,
    mcpHandler,
    procurementRoutes,
    authMiddleware,
    authRoutes,
    publicConfig: {
      agentId: config.agentId,
      webhookUrl: config.webhookUrl,
      webHost: config.webHost,
      webPort: config.webPort,
      version,
    },
  });

  const server = app.listen(config.webPort, config.webHost, () => {
    logger.info("web server listening", {
      url: `http://${config.webHost}:${config.webPort}`,
      db: config.dbPath,
    });
  });

  const shutdown = () => {
    logger.info("shutting down web server");
    server.close(() => db.close());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((err) => {
  process.stderr.write(`[mcp-taskbridge:web] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
