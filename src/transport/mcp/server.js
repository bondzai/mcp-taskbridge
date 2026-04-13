import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { adapterForClientName } from "../../core/client-detection.js";
import { createToolHandlers, toolDefinitions } from "./tools.js";

export const createMcpServer = ({
  service,
  adapterId,
  name = "mcp-taskbridge",
  version = "0.2.0",
}) => {
  if (!service) throw new Error("service is required");
  const handlers = createToolHandlers({ service, adapterId });
  const server = new McpServer({ name, version });
  for (const tool of toolDefinitions(handlers)) {
    server.registerTool(tool.name, tool.config, tool.run);
  }
  return { server, handlers };
};

/**
 * Stdio MCP server. After the SDK handshake completes we ask the underlying
 * Server for the connected client's clientInfo and use it to refine the
 * adapter id — so a client that registers `node bin/mcp.js` without setting
 * TASKBRIDGE_AGENT_ID still gets tagged correctly (e.g. Codex Desktop's
 * stdio path).
 */
export const startStdioMcpServer = async ({ service, adapterId, logger }) => {
  const { server, handlers } = createMcpServer({ service, adapterId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // McpServer wraps the low-level Server on `.server`; that's where
  // getClientVersion() lives.
  const clientInfo = server.server?.getClientVersion?.();
  if (clientInfo?.name) {
    const detected = adapterForClientName(clientInfo.name, adapterId);
    if (detected !== adapterId) {
      handlers.setAdapterId?.(detected);
      logger?.info?.("stdio mcp client detected", {
        clientName: clientInfo.name,
        clientVersion: clientInfo.version ?? null,
        from: adapterId,
        to: detected,
      });
    }
  }
  return { server, handlers };
};

/**
 * In-process Streamable HTTP MCP handler: an Express-style async handler
 * that creates a **fresh** McpServer + StreamableHTTPServerTransport for
 * every incoming request, processes it, and tears them both down on
 * response close. This is the SDK's recommended pattern for stateless
 * streamable HTTP: a single transport instance is single-use, so reusing
 * one for multiple requests yields 500s after the first.
 *
 * All fresh servers close over the SAME `service` / event bus, so tool
 * calls emit directly on the in-process bus that the SSE broadcaster
 * already listens to — no supergateway, no cross-process webhook,
 * no Mcp-Session-Id bookkeeping for clients to get wrong.
 *
 * Adapter selection is **per-request**, not per-process:
 *   1. If the request body is an `initialize`, read `clientInfo.name`
 *      and map it to a known adapter via the `clientTracker`. The mapping
 *      is cached keyed on `User-Agent + remoteAddress` so follow-up
 *      `tools/*` requests on the same connection resolve to the same id.
 *   2. Otherwise (e.g. `tools/call` with no prior initialize from this
 *      connection key), fall back to the tracker's cached value, or its
 *      static fallback (`TASKBRIDGE_AGENT_ID` in production).
 *   3. Tool callers can always override by passing an explicit `agent_id`
 *      argument to `claim_task` — that wins over everything else.
 */
export const createHttpMcpHandler = ({ service, clientTracker, name, version }) => {
  if (!service) throw new Error("service is required");
  if (!clientTracker) throw new Error("clientTracker is required");
  return async (req, res) => {
    // Detect-or-resolve before we spin up the server so the adapter id is
    // baked into the handlers from the start.
    const observed = clientTracker.observe(req, req.body);
    const adapterId = observed || clientTracker.resolve(req);

    const { server } = createMcpServer({ service, adapterId, name, version });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
};
