import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const env = process.env;

const parsePort = (value, fallback) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
};

const webHost = env.TASKBRIDGE_WEB_HOST || env.HOST || "0.0.0.0";
const webPort = parsePort(env.PORT || env.TASKBRIDGE_WEB_PORT, 3000);

export const config = {
  projectRoot,
  dbPath: env.TASKBRIDGE_DB_PATH || path.join(projectRoot, "data", "tasks.db"),
  webHost,
  webPort,
  webhookSecret: env.TASKBRIDGE_WEBHOOK_SECRET || "dev-secret-change-me",
  webhookUrl:
    env.TASKBRIDGE_WEBHOOK_URL || `http://${webHost}:${webPort}/webhooks/task-events`,
  agentId: env.TASKBRIDGE_AGENT_ID || "generic",
  dbDriver: env.DB_DRIVER || "sqlite",
  databaseUrl: env.DATABASE_URL || null,

  // Procurement — feature-gated
  procurement: {
    enabled: env.PROCUREMENT_ENABLED === "true" || env.PROCUREMENT_ENABLED === "1",
    gcpProject: env.PROCUREMENT_GCP_PROJECT || null,
  },
};
