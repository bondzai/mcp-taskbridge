# HTTP API

The web server exposes a small REST + SSE API plus one internal webhook receiver.

Base URL: `http://127.0.0.1:3000` (configurable via `TASKBRIDGE_WEB_HOST` / `TASKBRIDGE_WEB_PORT`)

All error responses share this shape:

```json
{ "error": "<human message>", "code": "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "INTERNAL" }
```

---

## `POST /api/tasks`

Create a new task.

**Request**
```http
POST /api/tasks
Content-Type: application/json

{ "prompt": "Summarize today's top Hacker News stories" }
```

**Response — 201**
```json
{
  "id": "f1c7...",
  "prompt": "Summarize today's top Hacker News stories",
  "status": "pending",
  "agentId": null,
  "result": null,
  "error": null,
  "progress": null,
  "createdAt": 1712700000000,
  "updatedAt": 1712700000000,
  "claimedAt": null,
  "completedAt": null
}
```

**Errors**

- `400 VALIDATION` — `prompt` missing, not a string, empty after trim, or over 8 000 characters

Side effect: emits `task.created` on the in-process event bus → broadcasts to every SSE subscriber.

---

## `GET /api/tasks`

List tasks, newest first.

**Query**

| Param | Type    | Default | Max |
|-------|---------|---------|-----|
| limit | integer | 100     | 500 |

**Response — 200**
```json
{ "tasks": [ { "id": "...", "status": "done", "agentId": "claude-cowork", ... }, ... ] }
```

---

## `GET /api/tasks/:id`

Fetch a single task.

**Responses**

- `200` — full task object
- `400 VALIDATION` — empty id segment
- `404 NOT_FOUND` — id not in DB

---

## `PATCH /api/tasks/:id`

Update a task's prompt. Only allowed while `status === pending` and the task is
not archived; once a task is claimed the prompt is locked (it's the contract
with whichever agent picked it up).

**Request**
```http
PATCH /api/tasks/<id>
Content-Type: application/json

{ "prompt": "new prompt text" }
```

**Responses**
- `200` — updated full task object, emits `task.updated`
- `400 VALIDATION` — missing / empty / oversize prompt
- `404 NOT_FOUND` — id not in DB
- `409 CONFLICT` — task is no longer `pending`, or is archived

---

## `POST /api/tasks/:id/archive` · `POST /api/tasks/:id/unarchive`

Soft-delete a task. Archived tasks are hidden from the default `GET /api/tasks`
response unless `?include_archived=true` is passed. Reachable by id at all times.
Both endpoints are **idempotent**: archiving an already-archived task (or
unarchiving an active one) returns the current state without throwing.

**Responses**
- `200` — full task object with `archivedAt` set / cleared
- `404 NOT_FOUND` — id not in DB

Emits `task.archived` / `task.unarchived` on the event bus.

---

## `DELETE /api/tasks/:id`

Hard-delete a task. The row is removed from SQLite. **Not reversible.**
For a reversible "delete", use archive instead.

**Response**
```json
{ "id": "<id>", "deleted": true }
```

- `200` — deleted, emits `task.deleted` (payload is `{ id }`)
- `404 NOT_FOUND` — id not in DB

---

## `GET /api/events`

Server-sent event stream. Clients receive named events with JSON data:

| Event              | Emitted by                                       | Data        |
|--------------------|--------------------------------------------------|-------------|
| `ready`            | Stream opens                                     | `{ "ok": true }` |
| `task.created`     | `POST /api/tasks`                                | full task   |
| `task.claimed`     | MCP `claim_task` → in-process bus / webhook      | full task   |
| `task.progress`    | MCP `report_progress` → in-process bus / webhook | full task   |
| `task.completed`   | MCP `submit_result` → in-process bus / webhook   | full task   |
| `task.failed`      | MCP `fail_task` → in-process bus / webhook       | full task   |
| `task.updated`     | `PATCH /api/tasks/:id`                           | full task   |
| `task.archived`    | `POST /api/tasks/:id/archive`                    | full task   |
| `task.unarchived`  | `POST /api/tasks/:id/unarchive`                  | full task   |
| `task.deleted`     | `DELETE /api/tasks/:id`                          | `{ id }`    |

Browser example:

```js
const es = new EventSource("/api/events");
es.addEventListener("task.completed", (e) => {
  const task = JSON.parse(e.data);
  console.log("done:", task.id, task.agentId);
});
```

---

## `GET /api/health`

Return a runtime snapshot for monitoring. Powers the `/status.html` page.

**Response — 200** (healthy) **or 503** (DB unreadable / tracker not wired)

```json
{
  "ok": true,
  "version": "0.3.0",
  "uptimeMs": 12345,
  "startedAt": 1712699980000,
  "db": {
    "ok": true,
    "journalMode": "wal",
    "tasks": { "total": 7, "pending": 1, "in_progress": 0, "done": 6, "failed": 0 },
    "error": null
  },
  "sse":  { "subscribers": 2 },
  "events": {
    "totalEmitted": 42,
    "lastCreatedAt": 1712700000000,
    "lastClaimedAt": 1712700001000,
    "lastProgressAt": null,
    "lastCompletedAt": 1712700005000,
    "lastFailedAt": null
  },
  "webhook": {
    "received": 15,
    "rejected": 0,
    "lastOkAt": 1712700005000,
    "lastRejectedAt": null
  },
  "mcp": {
    "status": "active",
    "lastActivityAt": 1712700005000,
    "activeWindowMs": 300000,
    "idleWindowMs": 3600000
  }
}
```

**What each field really means**

| Field                     | Observed how                                                                                   |
|---------------------------|------------------------------------------------------------------------------------------------|
| `db.ok` / `.tasks` / `.journalMode` | Direct SQLite probe (`COUNT(*) GROUP BY status`, `PRAGMA journal_mode`).               |
| `sse.subscribers`         | Number of live `GET /api/events` connections held open by the broadcaster.                     |
| `events.*`                | Counters + per-event-type timestamps, updated by an in-process subscriber on the event bus.    |
| `webhook.received / rejected / lastOk* / lastReject*` | Incremented by the `/webhooks/task-events` route on every request.         |
| `mcp.status`              | **Inferred** — `active` if any `task.claimed/progress/completed/failed` event or signed webhook arrived within `activeWindowMs` (5 min), `idle` within `idleWindowMs` (1 h), else `unknown`. The web server has no direct channel to `bin/mcp.js`. |
| `external[]`              | Dynamic probes of neighbouring tools that are NOT part of the web process. Runs on every `/api/health` request, in parallel, with short per-probe timeouts. Each entry: `{ id, label, kind, level, message, responseMs, checkedAt, hint }`. `level` is one of `ok`, `warn`, `off`, `bad`. The hardcoded default list (in `src/core/external-checks.js`) probes: (1) **supergateway** via an MCP `initialize` POST to `http://127.0.0.1:8000/mcp`, (2) **cloudflared tunnel** via `pgrep -f "cloudflared tunnel"`, (3) **stdio MCP clients** via the inferred `mcp.status`. `bin/web.js` opts into the default list; tests default to empty. |

**Status codes**

- `200` — `db.ok === true`.
- `503` — `db.ok === false` (the DB probe threw). The body is still the full snapshot so the caller can inspect `db.error`.

---

## `GET /api/config`

Return non-secret runtime config for the UI. Used by the settings page and the navbar version badge.

**Response — 200**

```json
{
  "agentId": "claude-cowork",
  "webhookUrl": "http://127.0.0.1:3000/webhooks/task-events",
  "webHost": "127.0.0.1",
  "webPort": 3000,
  "version": "0.3.0"
}
```

No secrets are exposed. Values are sourced from the `TASKBRIDGE_*` env vars and `package.json`'s `version` field. Anything the server couldn't determine comes back as `null`.

---

## `GET /api/changelog`

Return `CHANGELOG.md` from the project root as `text/markdown; charset=utf-8`. Powers the in-app changelog modal that opens when you click the version badge.

**Responses**

- `200` — raw Markdown body
- `404` — `projectRoot` wasn't wired through to `createApp`, or `CHANGELOG.md` is missing

Clients render it with `marked` + `DOMPurify` (see `src/transport/http/public/assets/chrome.js`).

---

## `POST /webhooks/task-events`

Internal endpoint. The MCP process POSTs task state changes here; external callers should not target it.

**Headers**

| Header                     | Required | Notes                                            |
|----------------------------|----------|--------------------------------------------------|
| `Content-Type`             | yes      | Must be `application/json`                       |
| `X-Taskbridge-Signature`   | yes      | `sha256=<hex>` HMAC of the raw body              |
| `X-Taskbridge-Event`       | no       | Duplicate of `event` in body, for easy logging   |

**Body**
```json
{ "event": "task.completed", "data": { "id": "...", ... }, "ts": 1712700000000 }
```

**Responses**

- `200` — signature verified, event re-broadcast to SSE subscribers
- `400` — empty body, unparseable JSON, or missing `event` / `data`
- `401` — signature missing, malformed, or mismatched (timing-safe comparison)

The route uses `express.raw` so the HMAC can be computed over the **exact bytes** the client sent. Parsing JSON before verifying would allow a re-serializer to slip past the check.

---

## Signature scheme

```
signature = "sha256=" + hex( HMAC-SHA256( TASKBRIDGE_WEBHOOK_SECRET, raw_body_bytes ) )
```

Reference implementation: `src/webhook/signer.js`. The helpers are exported as `signPayload(secret, payload)` and `verifySignature(secret, payload, signature)`.

Node example (this is exactly what `src/webhook/client.js` does):

```js
import crypto from "node:crypto";
const body = JSON.stringify({ event: "task.completed", data: task, ts: Date.now() });
const sig  = "sha256=" + crypto.createHmac("sha256", process.env.TASKBRIDGE_WEBHOOK_SECRET)
  .update(body)
  .digest("hex");
await fetch("http://127.0.0.1:3000/webhooks/task-events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Taskbridge-Signature": sig,
    "X-Taskbridge-Event": "task.completed",
  },
  body,
});
```
