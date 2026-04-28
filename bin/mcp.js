#!/usr/bin/env node
import { config } from "../src/config.js";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository, createAttachmentsRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { logger } from "../src/logger.js";
import { startStdioMcpServer } from "../src/transport/mcp/server.js";
import { createWebhookClient } from "../src/webhook/client.js";
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

const main = async () => {
  const db = openDatabase(config.dbPath);
  const repo = createTasksRepository(db);
  const attachmentsRepo = createAttachmentsRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events, attachmentsRepo });

  const webhook = createWebhookClient({
    url: config.webhookUrl,
    secret: config.webhookSecret,
    logger,
  });
  events.subscribe((event, data) => webhook.send(event, data));

  // ─── Procurement ───
  let extraTools = [];
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
    logger.info("procurement module enabled (mcp)");
  }

  logger.info("mcp server starting", {
    db: config.dbPath,
    webhookUrl: config.webhookUrl,
    agentId: config.agentId,
  });

  await startStdioMcpServer({ service, adapterId: config.agentId, logger, extraTools });
};

main().catch((err) => {
  process.stderr.write(`[mcp-taskbridge] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
