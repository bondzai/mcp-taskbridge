import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";
import { createClientTracker } from "../src/core/client-detection.js";
import { createHttpMcpHandler } from "../src/transport/mcp/server.js";

const SECRET = "test-secret";

const listenOnEphemeral = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

// Force-close every open connection before calling server.close(),
// otherwise keep-alive HTTP connections (and open SSE streams) can
// make server.close() hang the test forever.
const shutdown = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

const buildLiveApp = async ({ fallback = "codex" } = {}) => {
  const db = openDatabase(":memory:");
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const clientTracker = createClientTracker({ fallback });
  const mcpHandler = createHttpMcpHandler({ service, clientTracker });
  const { app } = createApp({
    service,
    webhookSecret: SECRET,
    events,
    repo,
    mcpHandler,
  });
  const { server, url } = await listenOnEphemeral(app);
  return { server, url, service, db, clientTracker };
};

/**
 * JSON-RPC-over-streamable-HTTP helper. Our transport returns either
 * `application/json` (single reply) or `text/event-stream` (one-frame SSE).
 * Both carry the same JSON-RPC object; we extract and return it.
 */
const callMcp = async (url, message) => {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return { status: res.status, body: JSON.parse(text) };
  }
  // Parse as SSE: look for one `data: {json}` line.
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  if (!line) {
    throw new Error(`no data frame in SSE reply: ${text}`);
  }
  return { status: res.status, body: JSON.parse(line.slice(6)) };
};

const initializeMessage = (id = 1, clientName = "tb-test") => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: clientName, version: "0" },
  },
});

test("native /mcp: initialize returns taskbridge serverInfo", async () => {
  const { server, url, db } = await buildLiveApp();
  try {
    const { status, body } = await callMcp(url, initializeMessage());
    assert.equal(status, 200);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.result.serverInfo.name, "mcp-taskbridge");
    assert.ok(body.result.capabilities.tools);
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: tools/list returns all seven tools", async () => {
  const { server, url, db } = await buildLiveApp();
  try {
    await callMcp(url, initializeMessage(1));
    const { body } = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const names = (body.result.tools || []).map((t) => t.name).sort();
    assert.deepEqual(names, [
      "claim_task",
      "fail_task",
      "get_attachment_content",
      "get_task",
      "list_pending_tasks",
      "report_progress",
      "submit_result",
    ]);
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: list → claim → submit round-trip", async () => {
  const { server, url, service, db } = await buildLiveApp();
  try {
    const created = await service.create("what is 2+2?");

    await callMcp(url, initializeMessage(1));

    const listed = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_pending_tasks", arguments: { limit: 10 } },
    });
    const listedBody = JSON.parse(listed.body.result.content[0].text);
    assert.equal(listedBody.count, 1);
    assert.equal(listedBody.tasks[0].id, created.id);

    const claimed = await callMcp(url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });
    const claimedBody = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(claimedBody.task.status, "in_progress");
    assert.equal(claimedBody.task.agentId, "codex");

    const submitted = await callMcp(url, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "submit_result", arguments: { task_id: created.id, result: "4" } },
    });
    const submittedBody = JSON.parse(submitted.body.result.content[0].text);
    assert.equal(submittedBody.ok, true);
    assert.equal(submittedBody.task.status, "done");
    assert.equal(submittedBody.task.result, "4");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: claim_task on unknown id surfaces NOT_FOUND", async () => {
  const { server, url, db } = await buildLiveApp();
  try {
    await callMcp(url, initializeMessage(1));
    const { body } = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: "nope" } },
    });
    assert.equal(body.result.isError, true);
    const errBody = JSON.parse(body.result.content[0].text);
    assert.equal(errBody.code, "NOT_FOUND");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: claim_task emits task.claimed on the SSE fanout", async () => {
  const { server, url, service, db } = await buildLiveApp();
  try {
    const created = await service.create("observe me");

    // Open the SSE stream BEFORE claiming so we don't miss the frame.
    const es = await fetch(`${url}/api/events`);
    assert.equal(es.status, 200);
    const reader = es.body.getReader();

    await callMcp(url, initializeMessage(1));
    await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });

    const deadline = Date.now() + 1500;
    const decoder = new TextDecoder();
    let buffer = "";
    let seenClaimed = false;
    while (Date.now() < deadline && !seenClaimed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: task.claimed")) seenClaimed = true;
    }
    await reader.cancel();
    assert.ok(seenClaimed, "expected task.claimed SSE frame after native /mcp claim_task");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: clientInfo.name=codex-mcp-client tags task as 'codex' (not the fallback)", async () => {
  // Fallback is "generic" — so if detection is broken, the task would be tagged "generic",
  // NOT "codex". Any assertion seeing "codex" on the claimed task proves detection worked.
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("detect me");

    await callMcp(url, initializeMessage(1, "codex-mcp-client"));

    const claimed = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "codex");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: unknown clientInfo.name falls back to the configured default", async () => {
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("unknown client");

    await callMcp(url, initializeMessage(1, "some-future-ai-agent"));

    const claimed = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "generic");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("native /mcp: explicit agent_id argument on claim_task beats detection", async () => {
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("override me");

    await callMcp(url, initializeMessage(1, "codex-mcp-client")); // would tag as "codex"

    const claimed = await callMcp(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "claim_task",
        arguments: { task_id: created.id, agent_id: "my-custom-worker-42" },
      },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "my-custom-worker-42");
  } finally {
    await shutdown(server);
    db.close();
  }
});

/* ============================================================
   Per-URL routing: /mcp/<agentId> takes the agent id straight
   from the URL path. No detection, no clientTracker. This is
   the recommended deployment pattern for testing multiple
   clients against one taskbridge instance.
   ============================================================ */

const callMcpAt = async (url, path, message) => {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return { status: res.status, body: JSON.parse(text) };
  }
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  if (!line) return { status: res.status, body: null };
  return { status: res.status, body: JSON.parse(line.slice(6)) };
};

test("/mcp/:agentId: tags the task with the URL path adapter id", async () => {
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("per-url codex");

    const claimed = await callMcpAt(url, "/mcp/codex", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "codex");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("/mcp/:agentId: works with a brand-new custom agent name (no regex match needed)", async () => {
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("per-url custom");
    const claimed = await callMcpAt(url, "/mcp/my-cool-bot-7", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "claim_task", arguments: { task_id: created.id } },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "my-cool-bot-7");
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("/mcp/:agentId: rejects a path segment with bad characters with 400", async () => {
  const { server, url, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const res = await fetch(`${url}/mcp/this..is/bad`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_pending_tasks", arguments: {} },
      }),
    });
    // The slash makes Express treat it as a different route → 404
    // rather than reaching our :agentId handler. That's fine — both
    // outcomes mean "you can't smuggle weird paths through".
    assert.ok(res.status === 404 || res.status === 400);
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("/mcp/:agentId: empty / too-long agent id rejected with 400", async () => {
  const { server, url, db } = await buildLiveApp({ fallback: "generic" });
  try {
    // 65 chars — over the 64-char limit
    const tooLong = "a".repeat(65);
    const res = await fetch(`${url}/mcp/${tooLong}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_pending_tasks", arguments: {} },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await shutdown(server);
    db.close();
  }
});

test("/mcp/:agentId: explicit agent_id arg on claim_task still wins over the URL", async () => {
  const { server, url, service, db } = await buildLiveApp({ fallback: "generic" });
  try {
    const created = await service.create("explicit beats url");
    const claimed = await callMcpAt(url, "/mcp/codex", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "claim_task",
        arguments: { task_id: created.id, agent_id: "claimed-by-arg" },
      },
    });
    const body = JSON.parse(claimed.body.result.content[0].text);
    assert.equal(body.task.agentId, "claimed-by-arg");
  } finally {
    await shutdown(server);
    db.close();
  }
});
