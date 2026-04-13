import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";

const SECRET = "test-secret";

const buildApp = () => {
  const db = openDatabase(":memory:");
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app } = createApp({ service, webhookSecret: SECRET, events, repo });
  return { app, service, repo, events };
};

/* ---------- Update prompt ---------- */

test("PATCH /api/tasks/:id: updates a pending task's prompt", async () => {
  const { app, service } = buildApp();
  const t = await service.create("first version");
  const res = await request(app).patch(`/api/tasks/${t.id}`).send({ prompt: "second version" });
  assert.equal(res.status, 200);
  assert.equal(res.body.prompt, "second version");
  assert.equal(res.body.status, "pending");
  // Service.get should reflect the change
  assert.equal(service.get(t.id).prompt, "second version");
});

test("PATCH /api/tasks/:id: 409 when task is in_progress (prompt locked)", async () => {
  const { app, service } = buildApp();
  const t = await service.create("locked when claimed");
  await service.claim(t.id, "tester");
  const res = await request(app).patch(`/api/tasks/${t.id}`).send({ prompt: "nope" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "CONFLICT");
});

test("PATCH /api/tasks/:id: 400 on empty / oversize prompt", async () => {
  const { app, service } = buildApp();
  const t = await service.create("ok");
  const r1 = await request(app).patch(`/api/tasks/${t.id}`).send({ prompt: "   " });
  assert.equal(r1.status, 400);
  const r2 = await request(app).patch(`/api/tasks/${t.id}`).send({ prompt: "x".repeat(8001) });
  assert.equal(r2.status, 400);
});

test("PATCH /api/tasks/:id: 404 on unknown id", async () => {
  const { app } = buildApp();
  const res = await request(app).patch("/api/tasks/nope").send({ prompt: "anything" });
  assert.equal(res.status, 404);
});

/* ---------- Archive / unarchive ---------- */

test("POST /api/tasks/:id/archive: hides from default list, idempotent", async () => {
  const { app, service } = buildApp();
  const t = await service.create("hide me");

  const arch = await request(app).post(`/api/tasks/${t.id}/archive`);
  assert.equal(arch.status, 200);
  assert.ok(arch.body.archivedAt);

  // Default list excludes archived
  const def = await request(app).get("/api/tasks");
  assert.equal(def.status, 200);
  assert.equal(def.body.tasks.find((x) => x.id === t.id), undefined);

  // include_archived=true reveals it
  const inc = await request(app).get("/api/tasks?include_archived=true");
  assert.equal(inc.body.tasks.find((x) => x.id === t.id)?.id, t.id);

  // Idempotent: second archive returns the same task without error
  const second = await request(app).post(`/api/tasks/${t.id}/archive`);
  assert.equal(second.status, 200);
});

test("POST /api/tasks/:id/unarchive: restores the task", async () => {
  const { app, service } = buildApp();
  const t = await service.create("restore me");
  await request(app).post(`/api/tasks/${t.id}/archive`);

  const un = await request(app).post(`/api/tasks/${t.id}/unarchive`);
  assert.equal(un.status, 200);
  assert.equal(un.body.archivedAt, null);

  const def = await request(app).get("/api/tasks");
  assert.ok(def.body.tasks.find((x) => x.id === t.id));
});

test("listPending excludes archived tasks", async () => {
  const { service } = buildApp();
  const a = await service.create("active 1");
  const b = await service.create("active 2");
  const c = await service.create("about to be archived");
  await service.archive(c.id);
  const pending = service.listPending();
  const ids = pending.map((t) => t.id).sort();
  assert.deepEqual(ids.sort(), [a.id, b.id].sort());
});

/* ---------- Delete ---------- */

test("DELETE /api/tasks/:id: removes the task and emits task.deleted", async () => {
  const { app, service, events } = buildApp();
  const t = await service.create("remove me");

  const seen = [];
  events.subscribe((event, data) => seen.push({ event, id: data.id }));

  const del = await request(app).delete(`/api/tasks/${t.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  const after = await request(app).get(`/api/tasks/${t.id}`);
  assert.equal(after.status, 404);

  assert.ok(seen.find((e) => e.event === "task.deleted" && e.id === t.id));
});

test("DELETE /api/tasks/:id: 404 on unknown id", async () => {
  const { app } = buildApp();
  const res = await request(app).delete("/api/tasks/nope");
  assert.equal(res.status, 404);
});

/* ---------- Complete with metadata ---------- */

test("submit_result metadata: model + tokens persisted; total auto-computed", async () => {
  const { service } = buildApp();
  const t = await service.create("token test");
  await service.claim(t.id);
  const done = await service.complete(t.id, "answer text", {
    model: "claude-opus-4-6",
    tokensIn: 1234,
    tokensOut: 567,
  });
  assert.equal(done.model, "claude-opus-4-6");
  assert.equal(done.tokensIn, 1234);
  assert.equal(done.tokensOut, 567);
  assert.equal(done.totalTokens, 1234 + 567); // auto-computed
});

test("submit_result metadata: explicit total_tokens overrides the sum", async () => {
  const { service } = buildApp();
  const t = await service.create("explicit total");
  await service.claim(t.id);
  const done = await service.complete(t.id, "answer", {
    model: "gpt-5",
    tokensIn: 10,
    tokensOut: 20,
    totalTokens: 999,
  });
  assert.equal(done.totalTokens, 999);
});

test("submit_result metadata: rejects bad token shapes", async () => {
  const { service } = buildApp();
  const t = await service.create("bad tokens");
  await service.claim(t.id);
  await assert.rejects(
    () => service.complete(t.id, "answer", { tokensIn: -5 }),
    { code: "VALIDATION" }
  );
});

test("submit_result metadata: omitted entirely → fields stay null", async () => {
  const { service } = buildApp();
  const t = await service.create("no meta");
  await service.claim(t.id);
  const done = await service.complete(t.id, "answer");
  assert.equal(done.model, null);
  assert.equal(done.tokensIn, null);
  assert.equal(done.tokensOut, null);
  assert.equal(done.totalTokens, null);
});
