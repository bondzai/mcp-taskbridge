import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/db/adapter.js";
import { SQLITE_SCHEMA, migrateSqlite } from "../src/db/sqlite-schema.js";
import { createTasksRepository } from "../src/core/repo.js";
import { TaskStatus } from "../src/core/status.js";

const fresh = async () => {
  const db = await createDatabase("sqlite", { path: ":memory:" });
  await db.exec(SQLITE_SCHEMA);
  await migrateSqlite(db);
  return { db, repo: createTasksRepository(db) };
};

test("insert: creates a pending task with timestamps and null agentId", async () => {
  const { repo } = await fresh();
  const task = await repo.insert("do a thing");
  assert.equal(task.status, TaskStatus.PENDING);
  assert.equal(task.prompt, "do a thing");
  assert.equal(task.agentId, null);
  assert.ok(task.id);
  assert.ok(task.createdAt > 0);
  assert.equal(task.updatedAt, task.createdAt);
});

test("getById: returns null for unknown/empty id", async () => {
  const { repo } = await fresh();
  assert.equal(await repo.getById("nope"), null);
  assert.equal(await repo.getById(""), null);
  assert.equal(await repo.getById(null), null);
});

test("listPending: orders by created_at asc, skips non-pending", async () => {
  const { repo } = await fresh();
  const a = await repo.insert("first");
  await new Promise((r) => setTimeout(r, 2));
  const b = await repo.insert("second");
  await new Promise((r) => setTimeout(r, 2));
  const c = await repo.insert("third");
  await repo.claim(b.id, "worker-1");
  const pending = await repo.listPending(20);
  assert.deepEqual(pending.map((t) => t.id), [a.id, c.id]);
});

test("claim: stamps agent_id and transitions pending → in_progress exactly once", async () => {
  const { repo } = await fresh();
  const t = await repo.insert("task");
  const claimed = await repo.claim(t.id, "alice");
  assert.equal(claimed.status, TaskStatus.IN_PROGRESS);
  assert.equal(claimed.agentId, "alice");
  assert.ok(claimed.claimedAt);
  assert.equal(await repo.claim(t.id, "bob"), null);
  assert.equal((await repo.getById(t.id)).agentId, "alice");
});

test("claim with null agentId is allowed", async () => {
  const { repo } = await fresh();
  const t = await repo.insert("task");
  const claimed = await repo.claim(t.id, null);
  assert.equal(claimed.agentId, null);
});

test("complete: only works on in_progress", async () => {
  const { repo } = await fresh();
  const t = await repo.insert("task");
  assert.equal(await repo.complete(t.id, "x"), null);
  await repo.claim(t.id, "w");
  const done = await repo.complete(t.id, "result");
  assert.equal(done.status, TaskStatus.DONE);
  assert.equal(done.result, "result");
  assert.equal(await repo.complete(t.id, "again"), null);
});

test("fail: works from pending or in_progress, refuses terminal", async () => {
  const { repo } = await fresh();
  const a = await repo.insert("a");
  const failedFromPending = await repo.fail(a.id, "nope");
  assert.equal(failedFromPending.status, TaskStatus.FAILED);

  const b = await repo.insert("b");
  await repo.claim(b.id, "w");
  const failedFromProgress = await repo.fail(b.id, "broke");
  assert.equal(failedFromProgress.status, TaskStatus.FAILED);

  const c = await repo.insert("c");
  await repo.claim(c.id, "w");
  await repo.complete(c.id, "ok");
  assert.equal(await repo.fail(c.id, "late"), null);
});

test("progress: only valid while in_progress", async () => {
  const { repo } = await fresh();
  const t = await repo.insert("t");
  assert.equal(await repo.progress(t.id, "half"), null);
  await repo.claim(t.id, "w");
  const result = await repo.progress(t.id, "halfway there");
  assert.equal(result.task.progress, "halfway there");
  assert.equal(result.entry.message, "halfway there");
  assert.equal(result.entry.step, null);
  const log = await repo.getProgressLog(t.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].message, "halfway there");
});

test("listByAgent: filters by agentId", async () => {
  const { repo } = await fresh();
  const a = await repo.insert("a");
  const b = await repo.insert("b");
  await repo.claim(a.id, "alice");
  await repo.claim(b.id, "bob");
  assert.equal((await repo.listByAgent("alice", 10)).length, 1);
  assert.equal((await repo.listByAgent("alice", 10))[0].id, a.id);
  assert.equal((await repo.listByAgent("nobody", 10)).length, 0);
});
