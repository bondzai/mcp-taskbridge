# Architecture

`mcp-taskbridge` is a local two-process system that lets you submit tasks from a browser and have **any MCP client** (Claude Desktop, Claude Code, Claude Cowork, generic) execute them through the Model Context Protocol, with results flowing back via HMAC-signed webhooks.

## Process topology

```
  ┌─────────────┐          HTTP           ┌──────────────────────────┐
  │   Browser   │ ──────────────────────▶ │   Web server              │
  │  (SSE UI)   │ ◀────────── SSE ─────── │   bin/web.js              │
  └─────────────┘                         │                           │
                                          │  POST /api/tasks          │
                                          │  GET  /api/tasks          │
                                          │  GET  /api/tasks/:id      │
                                          │  GET  /api/events (SSE)   │
                                          │  POST /webhooks/task-events
                                          └────────────┬──────────────┘
                                                       │
                                                       │ SQLite (WAL)
                                                       │ data/tasks.db
                                                       │
                                          ┌────────────┴──────────────┐
  ┌──────────────┐    stdio JSON-RPC      │   MCP server              │
  │  MCP client  │ ─────────────────────▶ │   bin/mcp.js              │
  │  (Cowork,    │ ◀───────────────────── │                           │
  │   Desktop,   │                        │  Tools:                   │
  │   Code, ...) │                        │   list_pending_tasks      │
  └──────────────┘                        │   get_task                │
                                          │   claim_task      ──► webhook POST
                                          │   submit_result   ──► webhook POST
                                          │   fail_task       ──► webhook POST
                                          │   report_progress ──► webhook POST
                                          └───────────────────────────┘
```

Two independent Node processes share one SQLite file:

| Process     | Entrypoint    | Started by                      | Purpose                                                                                     |
|-------------|---------------|---------------------------------|---------------------------------------------------------------------------------------------|
| Web server  | `bin/web.js`  | You (`npm run start:web`)       | Serves UI, REST API, SSE stream, and webhook receiver.                                      |
| MCP server  | `bin/mcp.js`  | The MCP client (stdio subprocess) | Exposes 6 MCP tools. On every state change, POSTs a signed webhook back to the web server. |

SQLite (WAL mode) is the **single source of truth**. Both processes read and write concurrently with no application-level coordination — the SQL `WHERE status = ...` clauses guard all transitions atomically.

## Module layout

```
src/
├── core/                ← transport-agnostic business layer
│   ├── db.js            ← openDatabase(): SQLite schema + pragmas
│   ├── repo.js          ← raw CRUD, one prepared statement per op
│   ├── service.js       ← validation, state transitions, typed errors, emits events
│   ├── events.js        ← in-process pub/sub bus (EventBus)
│   └── status.js        ← TaskStatus enum
├── adapters.js          ← per-agent claim instructions
│                          (claude-desktop / claude-code / claude-cowork / generic)
├── transport/
│   ├── http/
│   │   ├── app.js       ← createApp({ service, events, webhookSecret })
│   │   ├── routes.js    ← REST + SSE + webhook sink
│   │   ├── sse.js       ← createSseBroadcaster()
│   │   └── public/      ← static UI (index.html)
│   └── mcp/
│       ├── server.js    ← createMcpServer / startStdioMcpServer
│       └── tools.js     ← createToolHandlers + tool definitions (zod schemas)
├── webhook/
│   ├── signer.js        ← HMAC sign + timing-safe verify
│   └── client.js        ← createWebhookClient({ url, secret })
├── config.js            ← TASKBRIDGE_* env var parsing
└── logger.js            ← stderr-only structured logger
bin/
├── web.js               ← wires: db → repo → events → service → httpApp, events → sse
└── mcp.js               ← wires: db → repo → events → service → stdioMcp, events → webhook
```

The key split is **core ↔ transport**. `TaskService` has no idea whether it's being driven by Express or by an MCP tool handler — both transports just call the service and forward validation errors. The same suite of edge cases is therefore tested once at the service layer and once at each transport boundary.

## Event bus

`createEventBus()` is a tiny in-process pub/sub (Set of callbacks, async emit, subscriber errors isolated). Every state transition in `TaskService` emits a `TaskEvents.*` event with the full updated task as payload.

Subscribers differ per process:

- **Web process** subscribes with `sse.broadcast` → every connected browser gets the update.
- **MCP process** subscribes with `webhook.send` → the webhook client HMAC-signs and POSTs to `/webhooks/task-events` on the web server, which verifies the signature and re-broadcasts via SSE.

The cross-process hop (stdio MCP subprocess → HTTP webhook → web server SSE) is the reason for the webhook layer at all. Within a single process, the event bus alone is enough.

## Data model

```sql
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,      -- uuid v4
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed')),
  agent_id       TEXT,                  -- who claimed it (adapter id or explicit override)
  result         TEXT,                  -- set by submit_result
  error          TEXT,                  -- set by fail_task
  progress       TEXT,                  -- latest report_progress message
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  claimed_at     INTEGER,
  completed_at   INTEGER
);
CREATE INDEX idx_tasks_status     ON tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_agent      ON tasks(agent_id);
```

State machine:

```
  (create)              (claim_task)              (submit_result)
     │                       │                          │
     ▼                       ▼                          ▼
  pending ───────────▶ in_progress ──────────────────▶ done
     │                       │
     │                       │ (fail_task)
     └────(fail_task)────────┴──────────────────────▶ failed
```

Every transition is a single guarded SQL UPDATE of the form `WHERE id = ? AND status IN (...)`. Illegal transitions produce `changes === 0`, which the service maps to `ConflictError`, which transports render as HTTP 409 or an MCP error tool result with `code: "CONFLICT"`.

## Error model

`TaskService` throws three typed errors:

| Error            | HTTP | MCP code     | When                                                     |
|------------------|------|--------------|----------------------------------------------------------|
| `ValidationError`| 400  | `VALIDATION` | Input missing, wrong type, empty, or over a length cap   |
| `NotFoundError`  | 404  | `NOT_FOUND`  | `task_id` not in DB                                      |
| `ConflictError`  | 409  | `CONFLICT`   | Transition not allowed from current status (claim race, duplicate submit, progress on terminal, ...) |

Transports map these 1:1; anything else bubbles up as 500 / `INTERNAL`.

## Adapter abstraction

`src/adapters.js` is a tiny registry of per-agent metadata:

```js
ADAPTERS = {
  "claude-desktop": { id, label, instructions: "…submit_result…" },
  "claude-code":    { id, label, instructions: "…" },
  "claude-cowork":  { id, label, instructions: "…cowork runs many agents…" },
  "generic":        { id, label, instructions: "…" },
}
resolveAdapter(id)  // unknown → "generic"
```

`TASKBRIDGE_AGENT_ID` picks which adapter `bin/mcp.js` uses. The adapter's id becomes the default `agent_id` stamped on `claim_task` (callers can override by passing `agent_id` explicitly), and its `instructions` string is returned in the claim response so the MCP client sees a tailored nudge.

The tool *schemas* are identical across adapters — pure MCP with no client-specific assumptions — so any MCP client (including ones we don't know about yet) works via `generic`.

## End-to-end flow

1. **User submits a task** in the browser → `POST /api/tasks` → `service.create` → `events.emit("task.created", task)` → SSE fanout → browser shows `pending` card.
2. **User drives their MCP client**, e.g. *"use taskbridge to handle the oldest pending task."*
3. MCP client calls `list_pending_tasks`, picks an id, calls `get_task` (optional), then `claim_task({ task_id })`.
4. `claim_task` → `service.claim` (guarded SQL UPDATE, stamps `agent_id`) → emits `task.claimed` → webhook client HMAC-signs and POSTs to `/webhooks/task-events` → web server verifies sig → SSE fanout → browser flips to `in_progress` with agent tag.
5. The client does the actual work using its own tools.
6. The client calls `submit_result(task_id, result)` (or `fail_task(task_id, reason)`). Same path: service → event → webhook → SSE → browser flips to `done` / `failed`.

## Security boundaries

- **Webhooks are HMAC-signed.** Both processes know `TASKBRIDGE_WEBHOOK_SECRET`. The signature is computed over the **raw request body bytes** (`express.raw`, not `express.json`) so a re-serializer cannot slip past. Verification is timing-safe.
- **Bind to localhost by default.** `TASKBRIDGE_WEB_HOST=127.0.0.1` keeps the web server off the network.
- **Dev secret is insecure.** `dev-secret-change-me` is for localhost only. Exposing taskbridge via a tunnel or reverse proxy requires a strong secret plus an auth layer in front (see `docs/cowork.md`).
- **stderr-only logging in the MCP process.** MCP uses stdout as its JSON-RPC transport; `console.log` would corrupt the stream. The shared logger writes to stderr exclusively.
- **Length caps at the service layer.** Prompts, results, reasons, progress messages, and agent ids all have explicit maximum lengths so a pathological payload cannot run the DB out of space.

## Design choices and trade-offs

- **Two processes, shared SQLite (chosen)** vs single in-process HTTP MCP server. Two processes let any stdio-speaking MCP client connect without Cowork-specific or Desktop-specific wiring. The cost is one extra hop (MCP process → HTTP webhook), but that hop is also the "webhook" abstraction the original spec asked for.
- **In-process event bus + cross-process webhook** vs only webhooks. Using the bus inside each process avoids a useless `localhost` HTTP round-trip when the web process emits its own `task.created` event.
- **Pure service with typed errors** vs throwing strings. Typed errors let each transport render the right status/code without string-matching or re-sniffing.
- **Repository pattern** for DB access. Every state transition is one atomic SQL statement. No read-modify-write from JS means no race conditions.
- **Factory functions** (`createApp`, `createToolHandlers`, `createTaskService`, ...) instead of module-level singletons. Lets tests inject an in-memory DB and drive the full pipeline through `supertest` and the MCP client SDK without binding real ports.
- **Webhook is fire-and-observe, not fire-and-forget.** `createWebhookClient` logs failures to stderr but does not retry or block the tool response. The DB is authoritative; a lost webhook only means the UI misses one live update until the next page load.

## Known limitations

- **MCP client must be actively chatting** for tasks to run. There is no background execution — tools only fire while a client session is alive.
- **Single-user / single-machine.** No auth layer in front of the web UI, no multi-tenant isolation, no remote deployment. For Cowork over a public tunnel, add auth before exposing.
- **No webhook retry.** If the web server is down when the MCP process POSTs, the DB still has the correct state but the browser won't receive the live update. Refresh to recover.
- **SQLite only.** `better-sqlite3` gives us WAL + prepared statements + synchronous API (which keeps the repo trivial), at the cost of portability to Postgres etc. The repo boundary is narrow enough to swap out if that ever matters.
