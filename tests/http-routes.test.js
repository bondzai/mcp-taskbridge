import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDatabase } from "../src/core/db.js";
import { createEventBus } from "../src/core/events.js";
import { createTasksRepository } from "../src/core/repo.js";
import { createTaskService } from "../src/core/service.js";
import { createApp } from "../src/transport/http/app.js";
import { signPayload } from "../src/webhook/signer.js";

const SECRET = "test-secret";

const buildApp = () => {
  const db = openDatabase(":memory:");
  const repo = createTasksRepository(db);
  const events = createEventBus();
  const service = createTaskService({ repo, events });
  const { app, sse } = createApp({ service, webhookSecret: SECRET, events });
  return { app, service, sse, events };
};

test("POST /api/tasks: creates and returns 201", async () => {
  const { app } = buildApp();
  const res = await request(app).post("/api/tasks").send({ prompt: "do a thing" });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.prompt, "do a thing");
  assert.ok(res.body.id);
});

test("POST /api/tasks: 400 on missing/empty/non-string prompt", async () => {
  const { app } = buildApp();
  const r1 = await request(app).post("/api/tasks").send({});
  assert.equal(r1.status, 400);
  const r2 = await request(app).post("/api/tasks").send({ prompt: "   " });
  assert.equal(r2.status, 400);
  const r3 = await request(app).post("/api/tasks").send({ prompt: 42 });
  assert.equal(r3.status, 400);
});

test("POST /api/tasks: 400 on oversized prompt", async () => {
  const { app } = buildApp();
  const res = await request(app).post("/api/tasks").send({ prompt: "x".repeat(8001) });
  assert.equal(res.status, 400);
});

test("GET /api/tasks: lists all", async () => {
  const { app, service } = buildApp();
  await service.create("one");
  await service.create("two");
  const res = await request(app).get("/api/tasks");
  assert.equal(res.status, 200);
  assert.equal(res.body.tasks.length, 2);
});

test("GET /api/tasks/:id: 200 or 404", async () => {
  const { app, service } = buildApp();
  const created = await service.create("one");
  const ok = await request(app).get(`/api/tasks/${created.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.id, created.id);
  const missing = await request(app).get("/api/tasks/does-not-exist");
  assert.equal(missing.status, 404);
});

test("POST /webhooks/task-events: 401 missing signature", async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .send({ event: "task.completed", data: { id: "x" } });
  assert.equal(res.status, 401);
});

test("POST /webhooks/task-events: 401 bad signature", async () => {
  const { app } = buildApp();
  const payload = JSON.stringify({ event: "task.completed", data: { id: "x" } });
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", "sha256=deadbeef")
    .send(payload);
  assert.equal(res.status, 401);
});

test("POST /webhooks/task-events: accepts valid signature and broadcasts", async () => {
  const { app, sse } = buildApp();
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
  const { app } = buildApp();
  const sig = signPayload(SECRET, "");
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send("");
  assert.equal(res.status, 400);
});

test("POST /webhooks/task-events: 400 invalid JSON", async () => {
  const { app } = buildApp();
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
  const { app } = buildApp();
  const payload = JSON.stringify({ ts: 1 });
  const sig = signPayload(SECRET, payload);
  const res = await request(app)
    .post("/webhooks/task-events")
    .set("Content-Type", "application/json")
    .set("X-Taskbridge-Signature", sig)
    .send(payload);
  assert.equal(res.status, 400);
});
