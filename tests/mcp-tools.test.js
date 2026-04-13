import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createToolHandlers } from "../src/transport/mcp/tools.js";

const parse = (res) => JSON.parse(res.content[0].text);

const build = (adapterId = "claude-cowork") => {
  const db = openDatabase(":memory:");
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const webhookCalls = [];
  events.subscribe((event, data) => webhookCalls.push({ event, data }));
  const service = createTaskService({ repo, events });
  const handlers = createToolHandlers({ service, adapterId });
  return { service, handlers, webhookCalls };
};

test("listPending: empty when nothing pending", async () => {
  const { handlers } = build();
  const res = await handlers.listPending({});
  assert.equal(parse(res).count, 0);
});

test("listPending: returns created tasks", async () => {
  const { service, handlers } = build();
  await service.create("one");
  await service.create("two");
  const body = parse(await handlers.listPending({}));
  assert.equal(body.count, 2);
  assert.equal(body.tasks[0].status, "pending");
});

test("getTask: VALIDATION on missing id, NOT_FOUND on unknown id", async () => {
  const { handlers } = build();
  const missing = await handlers.getTask({});
  assert.equal(missing.isError, true);
  assert.equal(parse(missing).code, "VALIDATION");

  const unknown = await handlers.getTask({ task_id: "nope" });
  assert.equal(unknown.isError, true);
  assert.equal(parse(unknown).code, "NOT_FOUND");
});

test("claimTask: defaults agent_id to adapter id and emits claimed", async () => {
  const { service, handlers, webhookCalls } = build("claude-cowork");
  const t = await service.create("task");
  const res = await handlers.claimTask({ task_id: t.id });
  const body = parse(res);
  assert.equal(body.task.status, "in_progress");
  assert.equal(body.task.agentId, "claude-cowork");
  assert.match(body.instructions, /submit_result/);
  assert.equal(webhookCalls.at(-1).event, "task.claimed");
});

test("claimTask: respects explicit agent_id override", async () => {
  const { service, handlers } = build("claude-cowork");
  const t = await service.create("task");
  const res = await handlers.claimTask({ task_id: t.id, agent_id: "worker-42" });
  assert.equal(parse(res).task.agentId, "worker-42");
});

test("claimTask: CONFLICT on already-claimed", async () => {
  const { service, handlers } = build();
  const t = await service.create("task");
  await handlers.claimTask({ task_id: t.id });
  const res = await handlers.claimTask({ task_id: t.id });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "CONFLICT");
});

test("submitResult: completes and emits", async () => {
  const { service, handlers, webhookCalls } = build();
  const t = await service.create("task");
  await handlers.claimTask({ task_id: t.id });
  const body = parse(await handlers.submitResult({ task_id: t.id, result: "the answer" }));
  assert.equal(body.task.status, "done");
  assert.equal(body.task.result, "the answer");
  assert.equal(webhookCalls.at(-1).event, "task.completed");
});

test("submitResult: CONFLICT when task not in progress", async () => {
  const { service, handlers } = build();
  const t = await service.create("task");
  const res = await handlers.submitResult({ task_id: t.id, result: "x" });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "CONFLICT");
});

test("submitResult: VALIDATION when result is not a string", async () => {
  const { service, handlers } = build();
  const t = await service.create("task");
  await handlers.claimTask({ task_id: t.id });
  const res = await handlers.submitResult({ task_id: t.id, result: 42 });
  assert.equal(res.isError, true);
  assert.equal(parse(res).code, "VALIDATION");
});

test("failTask: records reason and emits", async () => {
  const { service, handlers, webhookCalls } = build();
  const t = await service.create("task");
  const body = parse(await handlers.failTask({ task_id: t.id, reason: "impossible" }));
  assert.equal(body.task.status, "failed");
  assert.equal(body.task.error, "impossible");
  assert.equal(webhookCalls.at(-1).event, "task.failed");
});

test("failTask: CONFLICT on terminal task", async () => {
  const { service, handlers } = build();
  const t = await service.create("task");
  await handlers.claimTask({ task_id: t.id });
  await handlers.submitResult({ task_id: t.id, result: "ok" });
  const res = await handlers.failTask({ task_id: t.id, reason: "late" });
  assert.equal(res.isError, true);
});

test("reportProgress: records message on in-progress", async () => {
  const { service, handlers, webhookCalls } = build();
  const t = await service.create("task");
  await handlers.claimTask({ task_id: t.id });
  const body = parse(await handlers.reportProgress({ task_id: t.id, message: "50%" }));
  assert.equal(body.task.progress, "50%");
  assert.equal(webhookCalls.at(-1).event, "task.progress");
});

test("reportProgress: CONFLICT when not in progress", async () => {
  const { service, handlers } = build();
  const t = await service.create("task");
  const res = await handlers.reportProgress({ task_id: t.id, message: "x" });
  assert.equal(res.isError, true);
});

test("handlers.adapter is the resolved adapter (unknown → generic)", async () => {
  const { handlers } = build("not-a-real-agent");
  assert.equal(handlers.adapter.id, "generic");
});
