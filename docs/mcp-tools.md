# MCP Tools

All tools are registered on the `mcp-taskbridge` MCP server and exposed over stdio JSON-RPC. Any MCP client that speaks the 2025-03 Streamable stdio dialect can connect — Claude Desktop, Claude Code, Claude Cowork (through a stdio→HTTP bridge, see `docs/cowork.md`), or anything else.

Every tool returns a `content` array with a single `text` block whose body is a JSON-serialized object:

```js
{ content: [{ type: "text", text: '{ ...payload... }' }] }
```

On error, `isError: true` is set and the text is:

```json
{ "error": "<human message>", "code": "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "INTERNAL" }
```

Transports map service-layer exceptions 1:1:

| Service error    | MCP `code`   |
|------------------|--------------|
| `ValidationError`| `VALIDATION` |
| `NotFoundError`  | `NOT_FOUND`  |
| `ConflictError`  | `CONFLICT`   |
| *other*          | `INTERNAL`   |

---

## `list_pending_tasks`

List tasks waiting to be handled.

**Input**

| Field   | Type    | Required | Default | Notes            |
|---------|---------|----------|---------|------------------|
| `limit` | integer | no       | 20      | Clamped to `[1, 50]` |

**Output**
```json
{ "count": 2, "tasks": [ { "id": "...", "prompt": "...", "status": "pending", "agentId": null, ... } ] }
```

Call this first to discover work.

---

## `get_task`

Fetch full details for a single task.

**Input**

| Field      | Type   | Required |
|------------|--------|----------|
| `task_id`  | string | yes      |

**Output:** the full task record.
**Errors:** `VALIDATION` on missing/empty id, `NOT_FOUND` if unknown.

---

## `claim_task`

Transition a pending task to `in_progress`. Must be called before `submit_result` or `report_progress`. Fires `task.claimed`.

**Input**

| Field       | Type   | Required | Notes                                                                 |
|-------------|--------|----------|-----------------------------------------------------------------------|
| `task_id`   | string | yes      |                                                                       |
| `agent_id`  | string | no       | Overrides the default stamped on the task. Max 128 chars, non-empty. |

If `agent_id` is omitted, the task is stamped with the **adapter id** configured via `TASKBRIDGE_AGENT_ID` (one of `claude-desktop`, `claude-code`, `claude-cowork`, `codex`, `antigravity`, `generic`). Unknown adapter ids fall back to `generic`.

**Output**
```json
{
  "task": { "id": "...", "status": "in_progress", "agentId": "claude-cowork", ... },
  "instructions": "When you finish this task you MUST call submit_result(task_id, result). ..."
}
```

The `instructions` string is tailored per adapter — Cowork gets a note about parallel workers and always including `agent_id` on claim.

**Errors:** `VALIDATION` on missing/empty/oversize inputs, `NOT_FOUND` if unknown, `CONFLICT` if the task is not `pending` (claim race, already done, etc).

---

## `submit_result`

Mark an `in_progress` task as `done` and deliver the result. Fires `task.completed`.

**Input**

| Field      | Type   | Required | Notes                                         |
|------------|--------|----------|-----------------------------------------------|
| `task_id`  | string | yes      |                                               |
| `result`   | string | yes      | Final answer for the user. Max 64 000 chars. |

**Output**
```json
{ "ok": true, "task": { "id": "...", "status": "done", "result": "..." } }
```

**Errors:** `VALIDATION` on missing/oversize `result`, `NOT_FOUND` if unknown, `CONFLICT` if the task is not `in_progress`.

---

## `fail_task`

Mark a task as `failed`. Fires `task.failed`. Valid from both `pending` and `in_progress`.

**Input**

| Field      | Type   | Required | Notes                     |
|------------|--------|----------|---------------------------|
| `task_id`  | string | yes      |                           |
| `reason`   | string | yes      | Non-empty. Max 2 000 chars. |

**Output**
```json
{ "ok": true, "task": { "id": "...", "status": "failed", "error": "..." } }
```

**Errors:** `VALIDATION` on missing/empty/oversize `reason`, `NOT_FOUND` if unknown, `CONFLICT` on already-terminal tasks.

---

## `report_progress`

Stream a short status update for an in-progress task. Optional but improves the browser UX.

**Input**

| Field      | Type   | Required | Notes                      |
|------------|--------|----------|----------------------------|
| `task_id`  | string | yes      |                            |
| `message`  | string | yes      | Short human-readable status. Max 2 000 chars. |

**Output**
```json
{ "ok": true, "task": { "id": "...", "progress": "..." } }
```

**Errors:** `VALIDATION` on missing/empty `message`, `NOT_FOUND` if unknown, `CONFLICT` if the task is not `in_progress`.

---

## Prompting the MCP client to use the tools

Add something like this to the chat (or a Project's custom instructions):

> You have access to the `mcp-taskbridge` MCP server. When I say "run taskbridge" or mention a pending task:
>
> 1. Call `list_pending_tasks`.
> 2. For the task you want to work on, call `get_task(task_id)` for full context.
> 3. Call `claim_task(task_id)` (pass `agent_id` if you are running as one of several parallel workers) to mark it in progress.
> 4. Do the work with your own tools (web search, file IO, etc.). Call `report_progress` for long-running work.
> 5. When done, **always** call `submit_result(task_id, result)`. If you cannot complete it, call `fail_task(task_id, reason)`. Never leave a task in `in_progress`.

## State machine summary

```
 pending ──claim_task──▶ in_progress ──submit_result──▶ done
    │                          │
    └────────fail_task──────────┴──────────────────────▶ failed
```
