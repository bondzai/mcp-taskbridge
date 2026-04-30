#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { createClientTracker } from "../src/core/client-detection.js";
import { createDatabase } from "../src/db/adapter.js";
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
  createItemStatusLogRepository,
  createRfxEventLogRepository,
  createRfxSendLogRepository,
} from "../src/procurement/repo.js";
import { createProcurementService } from "../src/procurement/service.js";
import { createProcurementToolHandlers, procurementToolDefinitions } from "../src/procurement/tools.js";
import { createProcurementRoutes } from "../src/procurement/routes.js";
import { evaluateShortlist } from "../src/procurement/decision-engine.js";
import { ProcurementEvents } from "../src/procurement/events.js";
import { buildRfqPayloads } from "../src/procurement/rfq-payload.js";
import { createEmailClient } from "../src/procurement/email-client.js";
import { debugLog } from "../src/procurement/debug-log.js";
import { createAuthMiddleware } from "../src/auth/middleware.js";
import { createAuthRoutes } from "../src/auth/routes.js";
import { createCurrencyProvider } from "../src/currency/provider.js";
import { createCurrencyCache } from "../src/currency/cache.js";

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
  const dbDriver = process.env.DB_DRIVER || "sqlite";
  const db = await createDatabase(dbDriver, {
    path: config.dbPath,
    url: process.env.DATABASE_URL,
  });

  if (dbDriver === "postgres") {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath: toPath } = await import("node:url");
    const schemaPath = join(dirname(toPath(import.meta.url)), "../src/db/schema.sql");
    await db.exec(await readFile(schemaPath, "utf8"));
  } else {
    const { SQLITE_SCHEMA, migrateSqlite } = await import("../src/db/sqlite-schema.js");
    await db.exec(SQLITE_SCHEMA);
    await migrateSqlite(db);
  }

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
      itemStatusLog: createItemStatusLogRepository(db),
      rfxEventLog: createRfxEventLogRepository(db),
      rfxSendLog: createRfxSendLogRepository(db),
    };

    const procService = createProcurementService({
      repos: procRepos,
      events,
      taskService: service,
    });

    const emailClient = createEmailClient({
      url: procurementConfig.emailServiceUrl,
      apiKey: procurementConfig.emailServiceApiKey,
      logger,
    });
    if (emailClient.isMock) {
      logger.info("email client: MOCK mode (set EMAIL_SERVICE_URL to enable)");
    } else {
      logger.info("email client: configured", { url: procurementConfig.emailServiceUrl });
    }

    const procHandlers = createProcurementToolHandlers({ service: procService });
    extraTools = procurementToolDefinitions(procHandlers);
    procurementRoutes = createProcurementRoutes({
      service: procService,
      rfxWebhookSecret: process.env.RFX_WEBHOOK_SECRET || null,
      logger,
    });

    // Wire event: on task.claimed → transition PR to processing
    events.subscribe(async (event, data) => {
      if (event !== "task.claimed" || !data?.metadata?.prId) return;
      try {
        await procService.onTaskClaimed(data.metadata.prId);
        logger.info("PR moved to processing (agent claimed task)", { prId: data.metadata.prId });
      } catch (err) {
        logger.error("onTaskClaimed error", { prId: data.metadata.prId, error: err.message });
      }
    });

    // Wire event: on pr.sourced → run decision engine → create RFQ emails
    events.subscribe(async (event, data) => {
      if (event !== ProcurementEvents.PR_SOURCED) return;
      try {
        const pr = await procService.getPr(data.id);
        const shortlist = pr.shortlist || [];
        const lineItems = pr.lineItems || [];
        const vendorIds = [...new Set(shortlist.map((s) => s.vendorId))];
        const vendorPromises = vendorIds.map((id) => procRepos.vendors.getById(id));
        const vendors = (await Promise.all(vendorPromises)).filter(Boolean);

        debugLog.add(data.id, "decision_engine_input", {
          shortlistCount: shortlist.length,
          vendorCount: vendors.length,
          vendorIds: vendorIds,
          vendorsLoaded: vendors.map(v => ({ id: v.id, name: v.name, email: v.email })),
        });

        const result = evaluateShortlist({ shortlist, lineItems, vendors });
        debugLog.add(data.id, "decision_engine_output", {
          valid: result.valid,
          rfqPlanCount: result.rfqPlan?.length || 0,
          warnings: result.warnings,
          errors: result.errors,
        });

        if (result.valid && result.rfqPlan.length > 0) {
          const rfqEmails = await procService.createRfqEmails(data.id, result.rfqPlan);

          const payloads = buildRfqPayloads({ pr, rfqPlan: result.rfqPlan, rfqEmails, lineItems, vendors });
          await procService.storeRfqPayloads(data.id, payloads);

          debugLog.add(data.id, "email_send_request", {
            count: payloads.length,
            mock: emailClient.isMock,
            vendors: payloads.map(p => p.vendor.name + " <" + p.vendor.email + ">"),
          });

          const sendResults = await emailClient.sendBatch(payloads);
          const sent = sendResults.filter(r => r.ok).length;
          const failed = sendResults.filter(r => !r.ok).length;

          // Persist each mail-service response for debug introspection.
          // Strip the full payload off before logging — we keep only request_summary.
          for (const r of sendResults) {
            try {
              const p = r.payload || {};
              await procRepos.rfxSendLog.insert({
                rfxId: r.rfxId,
                prId: data.id,
                vendorId: p.vendor?.id ?? null,
                ok: r.ok,
                mock: !!r.mock,
                statusCode: r.statusCode ?? null,
                responseBody: r.response ?? null,
                error: r.error ?? null,
                requestSummary: r.requestSummary ?? null,
              });
            } catch (e) {
              logger.warn("rfx_send_log persist failed", { rfxId: r.rfxId, error: e.message });
            }
          }

          debugLog.add(data.id, "email_send_response", {
            sent, failed,
            results: sendResults.map(({ payload, ...rest }) => rest),
          });

          logger.info("decision engine: RFQ payloads dispatched", {
            prId: data.id, total: payloads.length, sent, failed, mock: emailClient.isMock,
          });
        } else {
          debugLog.add(data.id, "decision_engine_failed", {
            errors: result.errors, warnings: result.warnings,
          });
          logger.warn("decision engine: shortlist validation failed", {
            prId: data.id, errors: result.errors, warnings: result.warnings,
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

  // Currency cache (in-process, TTL 1h, stale-while-revalidate, fallback floor)
  let currencyCache = null;
  try {
    const provider = await createCurrencyProvider();
    currencyCache = createCurrencyCache({ provider, logger });
    logger.info("currency: provider configured", { provider: provider.name });
  } catch (err) {
    logger.warn("currency: provider init failed — falling back to baked-in rates", { error: err.message });
  }

  const { app } = createApp({
    service,
    webhookSecret: config.webhookSecret,
    events,
    repo,
    currencyCache,
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
      rfxExternalBaseUrl: process.env.RFX_EXTERNAL_BASE_URL || "https://freeform-agents.web.app/rfx",
      llmConfigured: Boolean(process.env.OPENAI_API_KEY),
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
