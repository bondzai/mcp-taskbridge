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

## `GET /api/events`

Server-sent event stream. Clients receive named events with JSON data:

| Event            | Emitted by                            | Data       |
|------------------|---------------------------------------|------------|
| `ready`          | Stream opens                          | `{ "ok": true }` |
| `task.created`   | `POST /api/tasks`                     | full task  |
| `task.claimed`   | MCP `claim_task` → signed webhook     | full task  |
| `task.progress`  | MCP `report_progress` → signed webhook| full task  |
| `task.completed` | MCP `submit_result` → signed webhook  | full task  |
| `task.failed`    | MCP `fail_task` → signed webhook      | full task  |

Browser example:

```js
const es = new EventSource("/api/events");
es.addEventListener("task.completed", (e) => {
  const task = JSON.parse(e.data);
  console.log("done:", task.id, task.agentId);
});
```

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
