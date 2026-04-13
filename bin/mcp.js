#!/usr/bin/env node
import { config } from "../src/config.js";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { logger } from "../src/logger.js";
import { startStdioMcpServer } from "../src/transport/mcp/server.js";
import { createWebhookClient } from "../src/webhook/client.js";

const main = async () => {
  const db = openDatabase(config.dbPath);
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });

  const webhook = createWebhookClient({
    url: config.webhookUrl,
    secret: config.webhookSecret,
    logger,
  });
  events.subscribe((event, data) => webhook.send(event, data));

  logger.info("mcp server starting", {
    db: config.dbPath,
    webhookUrl: config.webhookUrl,
    agentId: config.agentId,
  });

  await startStdioMcpServer({ service, adapterId: config.agentId });
};

main().catch((err) => {
  process.stderr.write(`[mcp-taskbridge] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
