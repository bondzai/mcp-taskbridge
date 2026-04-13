# Setup

## Prerequisites

- **Node.js ≥ 18** (20+ recommended; the MCP SDK and `better-sqlite3` work fine on 18)
- **An MCP client** — Claude Desktop and Claude Code speak stdio natively; Claude Cowork needs the stdio→HTTP bridge described in `docs/cowork.md`
- A POSIX-ish shell (macOS / Linux / WSL)

## Install

```bash
cd /Users/jamesbond/Desktop/mcp-taskbridge
npm install
```

## Run the test suite

```bash
npm test
```

Expect **72 tests / 0 failures / ~15s**. The suite covers:

- `tests/core-repo.test.js` — raw SQL layer, claim race, agent filtering
- `tests/core-service.test.js` — validation, state transitions, event emission, subscriber isolation
- `tests/webhook-signer.test.js` — HMAC sign + timing-safe verify, tamper + length-mismatch rejection
- `tests/http-routes.test.js` — REST endpoints, signed webhooks, error mapping
- `tests/mcp-tools.test.js` — every tool, every error code, adapter fallback
- `tests/edge-cases.test.js` — parallel claim race, duplicate submit, oversize result, empty reason, multi-subscriber fanout, tampered body, limit capping, cross-agent isolation
- `tests/integration-mcp-stdio.test.js` — **spawns the real `bin/mcp.js` under the MCP SDK's `Client` + `StdioClientTransport`**, exercises `listTools` → `list_pending_tasks` → `claim_task` → `report_progress` → `submit_result`, verifies HMAC round-trip against a test HTTP server, and confirms unknown-agent fallback to `generic`.

The integration test is what proves the server is MCP-client-agnostic — if it passes, Cowork and any other MCP client will work over the same protocol (transport wrapping aside).

## Configure environment (optional)

Defaults work for local development. Override via environment variables:

| Variable                    | Default                                           | Purpose                                      |
|-----------------------------|---------------------------------------------------|----------------------------------------------|
| `TASKBRIDGE_DB_PATH`        | `<project>/data/tasks.db`                         | SQLite file path                             |
| `TASKBRIDGE_WEB_HOST`       | `127.0.0.1`                                       | Web server bind address                      |
| `TASKBRIDGE_WEB_PORT`       | `3000`                                            | Web server port                              |
| `TASKBRIDGE_WEBHOOK_URL`    | `http://<host>:<port>/webhooks/task-events`       | Where the MCP process POSTs state changes    |
| `TASKBRIDGE_WEBHOOK_SECRET` | `dev-secret-change-me`                            | HMAC secret shared between the two processes |
| `TASKBRIDGE_AGENT_ID`       | `generic`                                         | Adapter id (picks claim instructions)        |
| `TASKBRIDGE_DEBUG`          | unset                                             | Set to anything for verbose stderr logs      |

**For real use, set a strong `TASKBRIDGE_WEBHOOK_SECRET`** and make sure both processes see the same value:

```bash
export TASKBRIDGE_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

## Start the web server

```bash
npm run start:web
```

Expect a JSON log line on stderr like:

```json
{"ts":"...","level":"info","msg":"web server listening","meta":{"url":"http://127.0.0.1:3000","db":"..."}}
```

Open <http://127.0.0.1:3000> — the **MCP Taskbridge** UI should render.

## Register the MCP server with an MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (create it if missing):

```json
{
  "mcpServers": {
    "taskbridge": {
      "command": "node",
      "args": ["/Users/jamesbond/Desktop/mcp-taskbridge/bin/mcp.js"],
      "env": {
        "TASKBRIDGE_AGENT_ID": "claude-desktop",
        "TASKBRIDGE_WEBHOOK_SECRET": "the-same-secret-you-set-above"
      }
    }
  }
}
```

Then **fully quit and relaunch Claude Desktop** (⌘Q, not just close the window).

### Claude Code

Use Claude Code's MCP config flow to register the same `command` + `args` + `env`, setting `TASKBRIDGE_AGENT_ID=claude-code`. See the Claude Code docs for the current config file location.

### Claude Cowork

Cowork connectors only accept **remote HTTPS MCP URLs**, not local stdio. See `docs/cowork.md` for the stdio → HTTP bridge and public-tunnel setup. Set `TASKBRIDGE_AGENT_ID=claude-cowork` in the env passed to `bin/mcp.js`.

### Generic MCP client

Any other MCP client can spawn `bin/mcp.js` with no env at all — `TASKBRIDGE_AGENT_ID` defaults to `generic`, and unknown ids also fall back to `generic`, so nothing breaks.

## Verify the MCP server is connected

In a fresh chat with your MCP client, type:

> List the MCP tools you have available from the taskbridge server.

You should see all six: `list_pending_tasks`, `get_task`, `claim_task`, `submit_result`, `fail_task`, `report_progress`.

If not, check the client's log for spawn errors. Common causes:

- Absolute path to `bin/mcp.js` wrong
- Node not on `PATH` — set `"command": "/usr/local/bin/node"` (or whatever `which node` prints)
- Webhook secret mismatch — the web server will log `401` responses when it receives them; the symptom is *the UI never updates* even though DB state is correct

## End-to-end smoke test

See `docs/e2e-test.md` for the full step-by-step walkthrough:

- **Path A** — browser + HTTP only (no MCP client required): verifies the web server, SSE, signer, repo, and webhook sink.
- **Path B** — browser + a real MCP client: verifies the full stdio pipeline, including agent tagging, progress updates, and failure paths.

Short version: submit a task in the browser, tell your MCP client to handle pending taskbridge tasks, watch the card flip `pending → in_progress → done` live.

## Reset

To wipe the task history:

```bash
rm -rf data/
```

Then restart the web server. `better-sqlite3` recreates the schema on next open.
