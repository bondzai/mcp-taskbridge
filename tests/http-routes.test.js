import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createDatabase } from "../src/db/adapter.js";
import { SQLITE_SCHEMA, migrateSqlite } from "../src/db/sqlite-schema.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";
import { signPayload } from "../src/webhook/signer.js";

const SECRET = "test-secret";

const buildApp = async ({ withRepo = false, publicConfig = {}, externalChecks } = {}) => {
  const db = await createDatabase("sqlite", { path: ":memory:" });
  await db.exec(SQLITE_SCHEMA);
  await migrateSqlite(db);
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app, sse, health } = createApp({
    service,
    webhookSecret: SECRET,
    events,
    ...(withRepo ? { repo } : {}),
    ...(externalChecks !== undefined ? { externalChecks } : {}),
    publicConfig,
  });
  return { app, service, sse, events, health, repo };
};

test("POST /api/tasks: creates and returns 201", async () => {
  const { app } = await buildApp();
  const res = await request(app).post("/api/tasks").send({ prompt: "do a thing" });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.prompt, "do a thing");
  assert.ok(res.body.id);
});

test("POST /api/tasks: 400 on missing/empty/non-string prompt", async () => {
  const { app } = await buildApp();
  const r1 = await request(app).post("/api/tasks").send({});
  assert.equal(r1.status, 400);
  const r2 = await request(app).post("/api/tasks").send({ prompt: "   " });
  assert.equal(r2.status, 400);
  const r3 = await request(app).post("/api/tasks").send({ prompt: 42 });
  assert.equal(r3.status, 400);
});

test("POST /api/tasks: 400 on oversized prompt", async () => {
  const { app } = await buildApp();
  const res = await request(app).post("/api/tasks").send({ prompt: "x".repeat(8001) });
  assert.equal(res.status, 400);
});

test("GET /api/tasks: lists all", async () => {
  const { app, service } = await buildApp();
  await service.create("one");
  await service.create("two");
  const res = await request(app).get("/api/tasks");
  assert.equal(res.status, 200);
  assert.equal(res.body.tasks.length, 2);
});

test("GET /api/tasks/:id: 200 or 404", async () => {
  const { app, service } = await buildApp();
  const created = await service.create("one");
  const ok = await request(app).get(`/api/tasks/${created.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.id, created.id);
  const missing = await request(app).get("/api/tasks/does-not-exist");
  assert.equal(missing.status, 404);
});

test("POST /webhooks/task-events: 401 missing signature", async () => {
  const { app } = await buildApp();
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .send({ event: "task.completed", data: { id: "x" } });
  assert.equal(res.status, 401);
});

test("POST /webhooks/task-events: 401 bad signature", async () => {
  const { app } = await buildApp();
  const payload = JSON.stringify({ event: "task.completed", data: { id: "x" } });
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", "sha256=deadbeef")
    .send(payload);
  assert.equal(res.status, 401);
});

test("POST /webhooks/task-events: accepts valid signature and broadcasts", async () => {
  const { app, sse } = await buildApp();
  let broadcasted = null;
  const original = sse.broadcast.bind(sse);
  sse.broadcast = (event, data) => {
    broadcasted = { event, data };
    original(event, data);
  };

  const payload = JSON.stringify({ event: "task.completed", data: { id: "x", status: "done" } });
  const sig = signPayload(SECRET, payload);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(payload);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(broadcasted, { event: "task.completed", data: { id: "x", status: "done" } });
});

test("POST /webhooks/task-events: 400 empty body", async () => {
  const { app } = await buildApp();
  const sig = signPayload(SECRET, "");
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send("");
  assert.equal(res.status, 400);
});

test("POST /webhooks/task-events: 400 invalid JSON", async () => {
  const { app } = await buildApp();
  const payload = "{not json";
  const sig = signPayload(SECRET, payload);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(payload);
  assert.equal(res.status, 400);
});

test("POST /webhooks/task-events: 400 missing event/data", async () => {
  const { app } = await buildApp();
  const payload = JSON.stringify({ ts: 1 });
  const sig = signPayload(SECRET, payload);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(payload);
  assert.equal(res.status, 400);
});

test("GET /api/health: reports ok, db stats, and sse subscriber count", async () => {
  const { app, service } = await buildApp({ withRepo: true, publicConfig: { version: "test" } });
  await service.create("one");
  await service.create("two");
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.version, "test");
  assert.equal(res.body.db.ok, true);
  assert.equal(res.body.db.tasks.total, 2);
  assert.equal(res.body.db.tasks.pending, 2);
  assert.equal(res.body.sse.subscribers, 0);
  assert.equal(res.body.mcp.status, "unknown"); // no webhook traffic yet
  assert.ok(res.body.events.totalEmitted >= 2);
});

test("GET /api/health: webhook counters update on signed delivery", async () => {
  const { app } = await buildApp({ withRepo: true });
  // Reject one (bad sig), accept one (good sig).
  const badPayload = JSON.stringify({ event: "task.completed", data: { id: "x" } });
  await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", "sha256=deadbeef")
    .send(badPayload);

  const goodPayload = JSON.stringify({ event: "task.completed", data: { id: "x", status: "done" } });
  const sig = signPayload(SECRET, goodPayload);
  await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(goodPayload);

  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.webhook.received, 1);
  assert.equal(res.body.webhook.rejected, 1);
  assert.ok(res.body.webhook.lastOkAt !== null);
  assert.ok(res.body.webhook.lastRejectedAt !== null);
  assert.equal(res.body.mcp.status, "active");
});

test("GET /api/health: 503 when tracker has no repo wired up", async () => {
  const { app } = await buildApp(); // no repo → db.ok = false
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.db.ok, false);
});

test("GET /api/health: runs external checks when configured", async () => {
  const stubCheck = {
    id: "stub",
    label: "Stub check",
    kind: "custom",
    probe: async () => ({ level: "ok", message: "stub ok" }),
  };
  const { app } = await buildApp({ withRepo: true, externalChecks: [stubCheck] });
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.external));
  assert.equal(res.body.external.length, 1);
  assert.equal(res.body.external[0].id, "stub");
  assert.equal(res.body.external[0].level, "ok");
  assert.equal(res.body.external[0].message, "stub ok");
});

test("GET /api/health: external is empty array when no checks configured", async () => {
  const { app } = await buildApp({ withRepo: true }); // default: externalChecks = []
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.external, []);
});
