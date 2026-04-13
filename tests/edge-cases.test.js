import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";
import { createToolHandlers } from "../src/transport/mcp/tools.js";
import { signPayload } from "../src/webhook/signer.js";

const SECRET = "edge-secret";

const build = () => {
  const db = openDatabase(":memory:");
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app, sse } = createApp({ service, webhookSecret: SECRET, events });
  const handlers = createToolHandlers({ service, adapterId: "claude-cowork" });
  return { app, service, sse, events, handlers, repo };
};

const parse = (r) => JSON.parse(r.content[0].text);

test("edge: two cowork workers race to claim — only one wins", async () => {
  const { service, handlers } = build();
  const t = await service.create("race");
  const [a, b] = await Promise.all([
    handlers.claimTask({ task_id: t.id, agent_id: "worker-a" }),
    handlers.claimTask({ task_id: t.id, agent_id: "worker-b" }),
  ]);
  const wins = [a, b].filter((r) => !r.isError);
  const losses = [a, b].filter((r) => r.isError);
  assert.equal(wins.length, 1);
  assert.equal(losses.length, 1);
  assert.equal(parse(losses[0]).code, "CONFLICT");
  assert.ok(["worker-a", "worker-b"].includes(parse(wins[0]).task.agentId));
  assert.equal(service.get(t.id).status, "in_progress");
});

test("edge: submit_result for task already done → CONFLICT", async () => {
  const { service, handlers } = build();
  const t = await service.create("dup-submit");
  await handlers.claimTask({ task_id: t.id });
  await handlers.submitResult({ task_id: t.id, result: "first" });
  const res = await handlers.submitResult({ task_id: t.id, result: "second" });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "CONFLICT");
  assert.equal(service.get(t.id).result, "first");
});

test("edge: complete with oversize result → VALIDATION", async () => {
  const { service, handlers } = build();
  const t = await service.create("big");
  await handlers.claimTask({ task_id: t.id });
  const huge = "z".repeat(64_001);
  const res = await handlers.submitResult({ task_id: t.id, result: huge });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "VALIDATION");
});

test("edge: fail_task with empty reason → VALIDATION", async () => {
  const { service, handlers } = build();
  const t = await service.create("fail-me");
  const res = await handlers.failTask({ task_id: t.id, reason: "" });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "VALIDATION");
});

test("edge: fail_task missing reason → VALIDATION", async () => {
  const { service, handlers } = build();
  const t = await service.create("fail-me");
  const res = await handlers.failTask({ task_id: t.id });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "VALIDATION");
});

test("edge: multiple SSE subscribers all receive broadcasts", async () => {
  const { events } = build();
  let a = 0, b = 0;
  events.subscribe(() => a++);
  events.subscribe(() => b++);
  await events.emit("task.created", { id: "1" });
  await events.emit("task.claimed", { id: "1" });
  assert.equal(a, 2);
  assert.equal(b, 2);
});

test("edge: event subscriber that throws does not prevent others", async () => {
  const { events, service } = build();
  let ok = 0;
  events.subscribe(() => { throw new Error("boom"); });
  events.subscribe(() => { ok++; });
  await service.create("task");
  assert.ok(ok >= 1);
});

test("edge: HTTP webhook replay with wrong secret → 401", async () => {
  const { app } = build();
  const payload = JSON.stringify({ event: "task.completed", data: { id: "x" } });
  const sig = signPayload("wrong-secret", payload);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(payload);
  assert.equal(res.status, 401);
});

test("edge: HTTP webhook with matching sig but tampered body → 401", async () => {
  const { app } = build();
  const original = JSON.stringify({ event: "task.completed", data: { id: "x" } });
  const tampered = JSON.stringify({ event: "task.completed", data: { id: "y" } });
  const sig = signPayload(SECRET, original);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(tampered);
  assert.equal(res.status, 401);
});

test("edge: GET /api/tasks respects limit and caps at 500", async () => {
  const { app, service } = build();
  for (let i = 0; i < 5; i++) await service.create(`t${i}`);
  const res = await request(app).get("/api/tasks?limit=3");
  assert.equal(res.body.tasks.length, 3);
  const big = await request(app).get("/api/tasks?limit=99999");
  assert.ok(big.body.tasks.length <= 500);
});

test("edge: progress after completion → CONFLICT", async () => {
  const { service, handlers } = build();
  const t = await service.create("t");
  await handlers.claimTask({ task_id: t.id });
  await handlers.submitResult({ task_id: t.id, result: "ok" });
  const res = await handlers.reportProgress({ task_id: t.id, message: "late" });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "CONFLICT");
});

test("edge: claim with empty string agent_id → VALIDATION", async () => {
  const { service, handlers } = build();
  const t = await service.create("t");
  const res = await handlers.claimTask({ task_id: t.id, agent_id: "   " });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "VALIDATION");
});

test("edge: agents with different ids work on different tasks independently", async () => {
  const { service, repo } = build();
  const t1 = await service.create("a");
  const t2 = await service.create("b");
  await service.claim(t1.id, "claude-desktop");
  await service.claim(t2.id, "claude-cowork");
  assert.equal(repo.listByAgent("claude-desktop", 10).length, 1);
  assert.equal(repo.listByAgent("claude-cowork", 10).length, 1);
});
