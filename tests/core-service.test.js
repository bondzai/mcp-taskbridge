import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/db/adapter.js";
import { SQLITE_SCHEMA, migrateSqlite } from "../src/db/sqlite-schema.js";
import { createEventBus, TaskEvents } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createTaskService,
} from "../src/core/service.js";

const build = async () => {
  const db = await createDatabase("sqlite", { path: ":memory:" });
  await db.exec(SQLITE_SCHEMA);
  await migrateSqlite(db);
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const captured = [];
  events.subscribe((ev, data) => captured.push({ ev, data }));
  const service = createTaskService({ repo, events });
  return { service, repo, events, captured };
};

test("create: validates prompt and emits task.created", async () => {
  const { service, captured } = await build();
  await assert.rejects(() => service.create(""), ValidationError);
  await assert.rejects(() => service.create("   "), ValidationError);
  await assert.rejects(() => service.create(null), ValidationError);
  await assert.rejects(() => service.create(42), ValidationError);
  const task = await service.create("  do a thing  ");
  assert.equal(task.prompt, "do a thing");
  assert.equal(captured.at(-1).ev, TaskEvents.CREATED);
});

test("create: rejects oversized prompts", async () => {
  const { service } = await build();
  await assert.rejects(() => service.create("x".repeat(8001)), ValidationError);
});

test("get: throws NotFoundError on unknown id", async () => {
  const { service } = await build();
  await assert.rejects(() => service.get("missing"), NotFoundError);
  await assert.rejects(() => service.get(""), ValidationError);
});

test("claim: transitions and emits", async () => {
  const { service, captured } = await build();
  const t = await service.create("task");
  const claimed = await service.claim(t.id, "alice");
  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.agentId, "alice");
  assert.equal(captured.at(-1).ev, TaskEvents.CLAIMED);
});

test("claim: throws ConflictError when not pending", async () => {
  const { service } = await build();
  const t = await service.create("task");
  await service.claim(t.id, "alice");
  await assert.rejects(() => service.claim(t.id, "bob"), ConflictError);
});

test("claim: rejects unknown id", async () => {
  const { service } = await build();
  await assert.rejects(() => service.claim("nope", "alice"), NotFoundError);
});

test("complete: validates result, transitions, emits", async () => {
  const { service, captured } = await build();
  const t = await service.create("task");
  await service.claim(t.id, "alice");
  await assert.rejects(() => service.complete(t.id, ""), ValidationError);
  await assert.rejects(() => service.complete(t.id, 42), ValidationError);
  const done = await service.complete(t.id, "result payload");
  assert.equal(done.status, "done");
  assert.equal(done.result, "result payload");
  assert.equal(captured.at(-1).ev, TaskEvents.COMPLETED);
});

test("complete: conflicts on pending or already-done", async () => {
  const { service } = await build();
  const t = await service.create("task");
  await assert.rejects(() => service.complete(t.id, "x"), ConflictError);
  await service.claim(t.id, "w");
  await service.complete(t.id, "ok");
  await assert.rejects(() => service.complete(t.id, "again"), ConflictError);
});

test("fail: validates reason, works from pending or in_progress", async () => {
  const { service } = await build();
  const a = await service.create("a");
  await assert.rejects(() => service.fail(a.id, ""), ValidationError);
  const failedA = await service.fail(a.id, "impossible");
  assert.equal(failedA.status, "failed");
  assert.equal(failedA.error, "impossible");

  const b = await service.create("b");
  await service.claim(b.id, "w");
  const failedB = await service.fail(b.id, "broke");
  assert.equal(failedB.status, "failed");
});

test("fail: conflicts on terminal tasks", async () => {
  const { service } = await build();
  const t = await service.create("t");
  await service.claim(t.id, "w");
  await service.complete(t.id, "ok");
  await assert.rejects(() => service.fail(t.id, "late"), ConflictError);
});

test("progress: only valid while in_progress, validates message", async () => {
  const { service, captured } = await build();
  const t = await service.create("t");
  await assert.rejects(() => service.progress(t.id, "half"), ConflictError);
  await service.claim(t.id, "w");
  await assert.rejects(() => service.progress(t.id, ""), ValidationError);
  const result = await service.progress(t.id, "halfway there");
  assert.equal(result.task.progress, "halfway there");
  assert.equal(result.entry.message, "halfway there");
  assert.equal(captured.at(-1).ev, TaskEvents.PROGRESS);
});

test("listPending: clamps limit, default 20, max 50", async () => {
  const { service } = await build();
  for (let i = 0; i < 60; i++) await service.create(`t${i}`);
  assert.equal((await service.listPending()).length, 20);
  assert.equal((await service.listPending(5)).length, 5);
  assert.equal((await service.listPending(999)).length, 50);
  assert.equal((await service.listPending("bad")).length, 20);
});

test("subscribe/unsubscribe: errors in subscribers don't break emits", async () => {
  const { service } = await build();
  service; // use service so linter is happy
  const events = createEventBus();
  let calls = 0;
  events.subscribe(() => { throw new Error("boom"); });
  events.subscribe(() => { calls++; });
  await events.emit("x", {});
  assert.equal(calls, 1);
});
