#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { logger } from "../src/logger.js";
import { createApp } from "../src/transport/http/app.js";

const readPackageVersion = () => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
    return pkg.version;
  } catch {
    return null;
  }
};

const main = () => {
  const db = openDatabase(config.dbPath);
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app } = createApp({
    service,
    webhookSecret: config.webhookSecret,
    events,
    projectRoot: config.projectRoot,
    publicConfig: {
      agentId: config.agentId,
      webhookUrl: config.webhookUrl,
      webHost: config.webHost,
      webPort: config.webPort,
      version: readPackageVersion(),
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

main();
