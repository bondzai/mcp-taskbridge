import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

export const startStdioMcpServer = async ({ service, adapterId }) => {
  const { server, handlers } = createMcpServer({ service, adapterId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, handlers };
};
