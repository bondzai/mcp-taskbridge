import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/core/db.js";
import { createTasksRepository } from "../src/core/repo.js";
import { TaskStatus } from "../src/core/status.js";

const fresh = () => {
  const db = openDatabase(":memory:");
  return { db, repo: createTasksRepository(db) };
};

test("insert: creates a pending task with timestamps and null agentId", () => {
  const { repo } = fresh();
  const task = repo.insert("do a thing");
  assert.equal(task.status, TaskStatus.PENDING);
  assert.equal(task.prompt, "do a thing");
  assert.equal(task.agentId, null);
  assert.ok(task.id);
  assert.ok(task.createdAt > 0);
  assert.equal(task.updatedAt, task.createdAt);
});

test("getById: returns null for unknown/empty id", () => {
  const { repo } = fresh();
  assert.equal(repo.getById("nope"), null);
  assert.equal(repo.getById(""), null);
  assert.equal(repo.getById(null), null);
});

test("listPending: orders by created_at asc, skips non-pending", async () => {
  const { repo } = fresh();
  const a = repo.insert("first");
  await new Promise((r) => setTimeout(r, 2));
  const b = repo.insert("second");
  await new Promise((r) => setTimeout(r, 2));
  const c = repo.insert("third");
  repo.claim(b.id, "worker-1");
  const pending = repo.listPending(20);
  assert.deepEqual(pending.map((t) => t.id), [a.id, c.id]);
});

test("claim: stamps agent_id and transitions pending → in_progress exactly once", () => {
  const { repo } = fresh();
  const t = repo.insert("task");
  const claimed = repo.claim(t.id, "alice");
  assert.equal(claimed.status, TaskStatus.IN_PROGRESS);
  assert.equal(claimed.agentId, "alice");
  assert.ok(claimed.claimedAt);
  assert.equal(repo.claim(t.id, "bob"), null);
  assert.equal(repo.getById(t.id).agentId, "alice");
});

test("claim with null agentId is allowed", () => {
  const { repo } = fresh();
  const t = repo.insert("task");
  const claimed = repo.claim(t.id, null);
  assert.equal(claimed.agentId, null);
});

test("complete: only works on in_progress", () => {
  const { repo } = fresh();
  const t = repo.insert("task");
  assert.equal(repo.complete(t.id, "x"), null);
  repo.claim(t.id, "w");
  const done = repo.complete(t.id, "result");
  assert.equal(done.status, TaskStatus.DONE);
  assert.equal(done.result, "result");
  assert.equal(repo.complete(t.id, "again"), null);
});

test("fail: works from pending or in_progress, refuses terminal", () => {
  const { repo } = fresh();
  const a = repo.insert("a");
  const failedFromPending = repo.fail(a.id, "nope");
  assert.equal(failedFromPending.status, TaskStatus.FAILED);

  const b = repo.insert("b");
  repo.claim(b.id, "w");
  const failedFromProgress = repo.fail(b.id, "broke");
  assert.equal(failedFromProgress.status, TaskStatus.FAILED);

  const c = repo.insert("c");
  repo.claim(c.id, "w");
  repo.complete(c.id, "ok");
  assert.equal(repo.fail(c.id, "late"), null);
});

test("progress: only valid while in_progress", () => {
  const { repo } = fresh();
  const t = repo.insert("t");
  assert.equal(repo.progress(t.id, "half"), null);
  repo.claim(t.id, "w");
  const updated = repo.progress(t.id, "halfway there");
  assert.equal(updated.progress, "halfway there");
});

test("listByAgent: filters by agentId", () => {
  const { repo } = fresh();
  const a = repo.insert("a");
  const b = repo.insert("b");
  repo.claim(a.id, "alice");
  repo.claim(b.id, "bob");
  assert.equal(repo.listByAgent("alice", 10).length, 1);
  assert.equal(repo.listByAgent("alice", 10)[0].id, a.id);
  assert.equal(repo.listByAgent("nobody", 10).length, 0);
});
