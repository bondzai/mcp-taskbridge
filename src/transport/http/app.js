import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
}) => {
  if (!service) throw new Error("service is required");
  if (!webhookSecret) throw new Error("webhookSecret is required");

  if (events) {
    events.subscribe((event, data) => sse.broadcast(event, data));
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.static(publicDir));
  app.use(createRoutes({ service, sse, webhookSecret, publicConfig, projectRoot }));

  return { app, sse };
};
