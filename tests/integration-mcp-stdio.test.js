import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const mcpEntry = path.join(projectRoot, "bin", "mcp.js");

const freePort = () =>
  new Promise((resolve, reject) => {
    import("node:net").then((net) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
  });

const waitForHttp = async (url, attempts = 30) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`server at ${url} never became ready`);
};

const SECRET = "integration-secret";

const buildEnvironment = async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-taskbridge-it-"));
  const dbPath = path.join(tmpDir, "tasks.db");
  const port = await freePort();

  const db = openDatabase(dbPath);
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app } = createApp({ service, webhookSecret: SECRET, events });

  const httpServer = await new Promise((resolve) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
  });
  await waitForHttp(`http://127.0.0.1:${port}/api/tasks`);

  const cleanup = async () => {
    await new Promise((r) => httpServer.close(r));
    db.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };

  return { service, repo, port, dbPath, cleanup };
};

const connectClient = async ({ dbPath, port, agentId }) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    env: {
      ...process.env,
      TASKBRIDGE_DB_PATH: dbPath,
      TASKBRIDGE_WEB_HOST: "127.0.0.1",
      TASKBRIDGE_WEB_PORT: String(port),
      TASKBRIDGE_WEBHOOK_URL: `http://127.0.0.1:${port}/webhooks/task-events`,
      TASKBRIDGE_WEBHOOK_SECRET: SECRET,
      TASKBRIDGE_AGENT_ID: agentId,
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "test-mcp-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
};

const parse = (res) => {
  assert.ok(Array.isArray(res?.content) && res.content.length > 0, "tool returned no content");
  return JSON.parse(res.content[0].text);
};

const waitFor = async (check, attempts = 40) => {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor: condition never became true");
};

test("integration: MCP stdio client lists → claims → completes a task", async () => {
  const env = await buildEnvironment();
  const t = await env.service.create("integration prompt");
  const { client, transport } = await connectClient({
    dbPath: env.dbPath,
    port: env.port,
    agentId: "claude-cowork",
  });
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "claim_task",
      "fail_task",
      "get_task",
      "list_pending_tasks",
      "report_progress",
      "submit_result",
    ]);

    const pending = parse(
      await client.callTool({ name: "list_pending_tasks", arguments: {} })
    );
    assert.equal(pending.count, 1);
    assert.equal(pending.tasks[0].id, t.id);

    const claimed = parse(
      await client.callTool({ name: "claim_task", arguments: { task_id: t.id } })
    );
    assert.equal(claimed.task.status, "in_progress");
    assert.equal(claimed.task.agentId, "claude-cowork");

    await waitFor(() => env.service.get(t.id).status === "in_progress");

    parse(
      await client.callTool({
        name: "report_progress",
        arguments: { task_id: t.id, message: "halfway there" },
      })
    );
    await waitFor(() => env.service.get(t.id).progress === "halfway there");

    parse(
      await client.callTool({
        name: "submit_result",
        arguments: { task_id: t.id, result: "the final answer" },
      })
    );
    await waitFor(() => env.service.get(t.id).status === "done");

    const final = env.service.get(t.id);
    assert.equal(final.status, "done");
    assert.equal(final.result, "the final answer");
    assert.equal(final.agentId, "claude-cowork");
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await env.cleanup();
  }
});

test("integration: MCP stdio returns structured errors on bad input", async () => {
  const env = await buildEnvironment();
  const { client, transport } = await connectClient({
    dbPath: env.dbPath,
    port: env.port,
    agentId: "claude-cowork",
  });
  try {
    const res = await client.callTool({
      name: "get_task",
      arguments: { task_id: "does-not-exist" },
    });
    assert.equal(res.isError, true);
    const body = JSON.parse(res.content[0].text);
    assert.equal(body.code, "NOT_FOUND");
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await env.cleanup();
  }
});

test("integration: unknown agent id is preserved as the agent tag (uses generic adapter instructions)", async () => {
  // Behaviour as of v0.5.3: custom / unknown adapter ids are no longer
  // normalised to "generic". The raw id is used as the claim's agent tag,
  // while the *instructions* string still falls back to the generic
  // adapter's text. This is what makes /mcp/<custom-name> useful.
  const env = await buildEnvironment();
  const t = await env.service.create("unknown-agent-task");
  const { client, transport } = await connectClient({
    dbPath: env.dbPath,
    port: env.port,
    agentId: "some-future-mcp-we-dont-know-about",
  });
  try {
    const res = await client.callTool({
      name: "claim_task",
      arguments: { task_id: t.id },
    });
    const body = JSON.parse(res.content[0].text);
    assert.equal(body.task.status, "in_progress");
    assert.equal(body.task.agentId, "some-future-mcp-we-dont-know-about");
    // Instructions still come from the generic adapter
    assert.match(body.instructions, /submit_result/);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await env.cleanup();
  }
});
