# End-to-end test walkthrough

Two paths:

- **Path A** — Browser + HTTP only. No MCP client required. Verifies the web layer, SSE, repo, signer, and webhook round-trip.
- **Path B** — Browser + a real MCP client (Claude Desktop, Claude Code, Claude Cowork, …). Verifies the full stdio MCP pipeline.

For a quick one-liner after starting the web server, `make smoke` probes `/api/tasks`, `/api/config`, and `/api/changelog` and fails fast if anything is broken.

## Prerequisites

```bash
make install   # npm install
make test      # 72 / 72 green — works on Node 18–24+
make web       # http://127.0.0.1:3000
```

If you just switched Node versions, also run `make rebuild` (`npm rebuild better-sqlite3`) before the tests or you'll see a `NODE_MODULE_VERSION` crash.

> `npm test` (as shipped in `package.json`) breaks on Node 24+ because bare `tests/` is resolved as a module path. `make test` uses an explicit glob (`node --test tests/*.test.js`) and always works. All the steps below assume the web server is running on `http://127.0.0.1:3000` with the default dev secret `dev-secret-change-me`.

Open a second terminal for the `curl` steps.

---

## Path A — Browser + HTTP only

### A1. Open the UI

Visit <http://127.0.0.1:3000>. You should see the **MCP Taskbridge** page with an empty task list and a textarea.

### A2. Submit a task via the form

Type `summarize the plot of Dune in one sentence` and click **Submit**.

**Expect:** A card appears instantly with status `pending`.
**Proves:** HTTP POST `/api/tasks` → `TaskService.create` → in-process event bus → SSE → browser.

### A3. Pull the task id into the shell

```bash
TASK_ID=$(curl -s http://127.0.0.1:3000/api/tasks \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["tasks"][0]["id"])')
echo "task: $TASK_ID"
```

### A4. Fire a signed `task.claimed` webhook (simulate the MCP agent)

```bash
PAYLOAD=$(printf '{"event":"task.claimed","data":{"id":"%s","status":"in_progress","agentId":"claude-cowork","prompt":"summarize..."}}' "$TASK_ID")
SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac 'dev-secret-change-me' -hex | awk '{print $2}')"
curl -s -X POST http://127.0.0.1:3000/webhooks/task-events \
  -H "Content-Type: application/json" \
  -H "X-Taskbridge-Signature: $SIG" \
  -d "$PAYLOAD"
```

**Expect:** Response body `{"ok":true}`. Browser card flips to `in_progress`, with `claude-cowork` tag.
**Proves:** HMAC verify (constant-time) → SSE broadcast to every subscriber.

### A5. Tamper check (must fail)

```bash
curl -s -i -X POST http://127.0.0.1:3000/webhooks/task-events \
  -H "Content-Type: application/json" \
  -H "X-Taskbridge-Signature: sha256=deadbeef" \
  -d "$PAYLOAD" | head -1
```

**Expect:** `HTTP/1.1 401 Unauthorized`. Browser card does **not** change.
**Proves:** Signature verification rejects wrong HMACs.

### A6. Tampered body, correct-length sig (must fail)

```bash
ORIGINAL=$(printf '{"event":"task.completed","data":{"id":"x"}}')
TAMPERED=$(printf '{"event":"task.completed","data":{"id":"y"}}')
SIG="sha256=$(printf '%s' "$ORIGINAL" | openssl dgst -sha256 -hmac 'dev-secret-change-me' -hex | awk '{print $2}')"
curl -s -i -X POST http://127.0.0.1:3000/webhooks/task-events \
  -H "Content-Type: application/json" \
  -H "X-Taskbridge-Signature: $SIG" \
  -d "$TAMPERED" | head -1
```

**Expect:** `HTTP/1.1 401 Unauthorized`.
**Proves:** Replayed signatures on mutated payloads are rejected even when lengths match.

### A7. Input validation on `POST /api/tasks`

```bash
curl -s -i -X POST http://127.0.0.1:3000/api/tasks \
  -H "Content-Type: application/json" -d '{}' | head -1
curl -s -i -X POST http://127.0.0.1:3000/api/tasks \
  -H "Content-Type: application/json" -d '{"prompt":"   "}' | head -1
curl -s -i -X POST http://127.0.0.1:3000/api/tasks \
  -H "Content-Type: application/json" -d '{"prompt":42}' | head -1
```

**Expect:** All three return `HTTP/1.1 400 Bad Request` with `{"error":"prompt ...", "code":"VALIDATION"}`.
**Proves:** Service layer validates input at the HTTP boundary.

### A8. Not-found path

```bash
curl -s -i http://127.0.0.1:3000/api/tasks/does-not-exist | head -1
```

**Expect:** `HTTP/1.1 404 Not Found`.

### A9. Live SSE stream sanity check

```bash
curl -N http://127.0.0.1:3000/api/events
```

Leave this running. In a **third** terminal, submit another task:

```bash
curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"sse smoke"}'
```

**Expect:** The SSE stream emits a `task.created` event frame carrying the new task JSON.
**Proves:** In-process event bus fans out to SSE subscribers.

Kill the stream with `Ctrl+C`.

---

## Path B — Real MCP client

### B1. Register the MCP server

For **Claude Desktop**, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "taskbridge": {
      "command": "node",
      "args": ["/Users/jamesbond/Desktop/mcp-taskbridge/bin/mcp.js"],
      "env": {
        "TASKBRIDGE_AGENT_ID": "claude-desktop",
        "TASKBRIDGE_WEBHOOK_SECRET": "dev-secret-change-me"
      }
    }
  }
}
```

For **Claude Code**, register the same command via the Claude Code MCP config and set `TASKBRIDGE_AGENT_ID=claude-code`.

For **Claude Cowork**, set `TASKBRIDGE_AGENT_ID=claude-cowork`. The tool schemas are identical.

For any other MCP client, point it at `bin/mcp.js` with `TASKBRIDGE_AGENT_ID=generic` (or omit — unknown ids fall back to `generic`).

### B2. Reload the MCP client

Restart the client so it spawns a new stdio subprocess for taskbridge. It should show all 6 tools:

- `list_pending_tasks`
- `get_task`
- `claim_task`
- `submit_result`
- `fail_task`
- `report_progress`

### B3. Submit a task from the browser

At <http://127.0.0.1:3000>, submit e.g. `what day is it today?`. Card appears as `pending`.

### B4. Drive the MCP client

Send the client this message:

> Check taskbridge for pending tasks, claim the oldest one, answer it, and submit the result.

**Expect timeline in the browser:**

1. `pending` → `in_progress` (fires when the client calls `claim_task`)
2. The `agentId` tag matches `TASKBRIDGE_AGENT_ID` (e.g. `claude-desktop`)
3. Optional progress line (if the client calls `report_progress`)
4. `in_progress` → `done` with the result text (fires when the client calls `submit_result`)

**Proves:** stdio MCP transport + tool handlers + cross-process HMAC webhook + SSE fanout all wired end-to-end.

### B5. Verify final DB state

```bash
curl -s http://127.0.0.1:3000/api/tasks | python3 -m json.tool | head -40
```

Check:

- `status: "done"`
- `agentId` set to the configured adapter id
- `result` contains the answer text
- `claimedAt` < `completedAt`
- `updatedAt` reflects the latest change

### B6. Failure path

Submit a task the client cannot answer (e.g. `execute rm -rf /`). Ask the client to call `fail_task` with a reason.

**Expect:** Card flips to `failed` with the reason rendered as `error: ...`.

### B7. Race test (multi-worker)

Submit one task, then in **two** different MCP clients (e.g. Claude Desktop + Claude Code) ask both to claim it simultaneously.

**Expect:** Exactly one client's `claim_task` call succeeds; the other receives an MCP tool error with `code: "CONFLICT"` and the message `task <id> is in_progress, cannot claim`.

---

## Cleanup

Stop the server:

```bash
# kill the `npm run start:web` process
# or, if started in the background through Claude: ask to stop it
```

Remove the dev database if you want a clean slate:

```bash
rm -rf data/tasks.db*
```

---

## Troubleshooting

| Symptom                                         | Likely cause                                                        |
|-------------------------------------------------|---------------------------------------------------------------------|
| `EADDRINUSE`                                    | Port 3000 already taken. Set `TASKBRIDGE_WEB_PORT=<other>`.         |
| `401` on every webhook                          | Secret mismatch. Both sides must share `TASKBRIDGE_WEBHOOK_SECRET`. |
| MCP client sees no tools                        | Client didn't reload after editing config. Fully restart it.        |
| `pending` card never flips                      | MCP process can't reach the web server. Check `TASKBRIDGE_WEBHOOK_URL` is reachable from the MCP process and matches the web server's host/port. |
| `CONFLICT` when claiming                        | Task already claimed by another agent. Pick a different one.       |
| Integration test hangs in CI                    | Sandbox blocks stdio subprocess spawning. Run locally.              |
