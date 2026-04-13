# Setup

## Prerequisites

- **Node.js ≥ 18** (20+ recommended — SDK and `better-sqlite3` run fine on both).
- **An MCP client** — Claude Desktop and Claude Code speak stdio natively; Cowork (and any cloud MCP client) needs the HTTPS bridge in [`cowork.md`](cowork.md).
- A POSIX-ish shell (macOS / Linux / WSL).
- `make` (preinstalled on macOS / Linux). Everything below has a `npm run` fallback if you'd rather skip it.

## Install

```bash
make install   # same as: npm install
```

### Rebuild native deps after a Node version change

`better-sqlite3` compiles a native addon at install time. If you later switch Node versions (e.g. via `nvm`) it'll crash with `NODE_MODULE_VERSION mismatch`. Rebuild once:

```bash
make rebuild   # same as: npm rebuild better-sqlite3
```

## Run the tests

```bash
make test      # node --test tests/*.test.js — expect 72 / 72, ~1s
```

> On Node 24+, `npm test` as written in `package.json` fails because bare `tests/` is resolved as a module path. `make test` works around that with an explicit glob. If you invoke Node directly, use `node --test --test-concurrency=1 tests/*.test.js`.

The suite covers the core repo, service layer, HTTP routes, SSE, webhook signer, every MCP tool / error code, and an integration test that spawns `bin/mcp.js` under the MCP SDK's `StdioClientTransport`.

## Configure environment

Defaults work for local development. Override via environment variables:

| Variable                    | Default                                           | Purpose                                      |
|-----------------------------|---------------------------------------------------|----------------------------------------------|
| `TASKBRIDGE_DB_PATH`        | `<project>/data/tasks.db`                         | SQLite file path                             |
| `TASKBRIDGE_WEB_HOST`       | `127.0.0.1`                                       | Web server bind address                      |
| `TASKBRIDGE_WEB_PORT`       | `3000`                                            | Web server port                              |
| `TASKBRIDGE_WEBHOOK_URL`    | `http://<host>:<port>/webhooks/task-events`       | Where the MCP process POSTs state changes    |
| `TASKBRIDGE_WEBHOOK_SECRET` | `dev-secret-change-me`                            | HMAC secret shared between the two processes |
| `TASKBRIDGE_AGENT_ID`       | `generic`                                         | Adapter id (picks claim instructions)        |
| `TASKBRIDGE_DEBUG`          | unset                                             | Set to any value for verbose stderr logs     |

**For anything non-localhost, set a strong webhook secret** and make sure both processes see the same value:

```bash
export TASKBRIDGE_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

## Start the web server

```bash
make web       # same as: npm run start:web
```

Expect a JSON log line on stderr:

```json
{"ts":"…","level":"info","msg":"web server listening","meta":{"url":"http://127.0.0.1:3000","db":"…"}}
```

Then open <http://127.0.0.1:3000>. You'll see the tasks dashboard; `/settings.html` has the theme picker and server info.

## Register the MCP server with an MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Fully quit and relaunch Claude Desktop (⌘Q, not just close the window).

### Claude Code

Register the same `command` / `args` / `env` via Claude Code's MCP config, with `TASKBRIDGE_AGENT_ID=claude-code`.

### Claude Cowork

Cowork connectors only accept remote HTTPS MCP URLs. See [`cowork.md`](cowork.md) for the supergateway + cloudflared bridge. Set `TASKBRIDGE_AGENT_ID=claude-cowork`.

### OpenAI Codex

Codex has a first-class MCP CLI — one command registers taskbridge and writes the right entry into `~/.codex/config.toml`:

```bash
make mcp-register-codex
```

Under the hood this runs `codex mcp add taskbridge --env TASKBRIDGE_AGENT_ID=codex --env TASKBRIDGE_WEBHOOK_SECRET=… -- /path/to/node /path/to/bin/mcp.js`. Verify with `make mcp-list-codex` — you should see `taskbridge` in the table alongside any existing servers. Remove later with `make mcp-unregister-codex`.

The Makefile auto-detects the binary at `/Applications/Codex.app/Contents/Resources/codex` when `codex` isn't on `PATH`. Override with `make mcp-register-codex CODEX_BIN=/some/other/path`.

### Google Antigravity

Antigravity is a VS Code fork and ships VS Code's native MCP implementation, so configuration lives at:

```
~/Library/Application Support/Antigravity/User/mcp.json
```

Two ways to register:

1. **Command palette** — open Antigravity, press ⌘⇧P, run **MCP: Add Server…**, pick **Command (stdio)**, and point it at `bin/mcp.js` with env `TASKBRIDGE_AGENT_ID=antigravity`.
2. **Copy-paste** — run `make mcp-register-antigravity` to print the exact `mcp.json` snippet with correct absolute paths for this machine, then paste it into the file above and relaunch Antigravity.

After registering, open the Antigravity MCP panel (command palette → **MCP: Show Installed Servers**) — taskbridge should appear with all 6 tools. If not, check Antigravity's Output panel → **MCP** channel for spawn errors.

### Any other MCP client

Spawn `bin/mcp.js` with no env at all — `TASKBRIDGE_AGENT_ID` defaults to `generic`, and unknown ids also fall back to `generic`.

## Verify the connection

In a fresh chat, ask your MCP client:

> List the MCP tools you have available from the taskbridge server.

You should see all six: `list_pending_tasks`, `get_task`, `claim_task`, `submit_result`, `fail_task`, `report_progress`.

If not, check the client log for spawn errors. Common causes:

- Wrong absolute path to `bin/mcp.js`
- `node` not on the client's `PATH` — use `"command": "/usr/local/bin/node"` (or whatever `which node` prints)
- Webhook secret mismatch — the DB still updates correctly, but the browser card never flips because the web server rejects the signed webhook with `401`

## End-to-end smoke test

Full walkthrough (HTTP-only + real MCP client): [`e2e-test.md`](e2e-test.md).

Short version: submit a task in the browser, then prompt your MCP client to handle pending taskbridge tasks. Watch the card flip `pending → in_progress → done` live.

## Reset

```bash
make clean     # rm -f data/tasks.db data/tasks.db-shm data/tasks.db-wal
```

Then restart the web server — the schema is re-created on next open.
