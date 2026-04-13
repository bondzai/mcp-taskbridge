# MCP Taskbridge

A tiny local bridge that lets you submit tasks from a browser and have **any MCP client** (Claude Desktop, Claude Code, Claude Cowork, ...) execute them through the Model Context Protocol, with results streaming back to the UI via HMAC-signed webhooks.

```
[Browser] ─▶ [Web server] ─▶ SQLite ◀─ [MCP server] ◀─▶ [MCP client]
   ▲                                         │
   └────────── SSE ◀── webhook ◀─────────────┘
```

## Quick start

```bash
npm install
npm test            # unit + integration, all green
npm run start:web   # http://127.0.0.1:3000
```

Then register the MCP server (`bin/mcp.js`) in your MCP client and reload it.

## Agent adapters

`TASKBRIDGE_AGENT_ID` selects an adapter whose claim instructions are tailored to a specific MCP client. Built-in adapters:

| Adapter id       | For                   |
|------------------|-----------------------|
| `claude-desktop` | Claude Desktop        |
| `claude-code`    | Claude Code CLI       |
| `claude-cowork`  | Claude Cowork         |
| `generic`        | Any other MCP client  |

The tool schemas are pure MCP — no client-specific assumptions — so unknown MCP clients also work via the `generic` adapter.

## What's in the box

| Path                              | Purpose                                                  |
|-----------------------------------|----------------------------------------------------------|
| `bin/web.js`                      | Entrypoint: starts the web server                        |
| `bin/mcp.js`                      | Entrypoint: starts the stdio MCP server                  |
| `src/core/`                       | DB, repo, task service, in-process event bus             |
| `src/transport/http/`             | Express app, routes, SSE broadcaster, static UI          |
| `src/transport/mcp/`              | stdio MCP server + generic tool definitions             |
| `src/webhook/`                    | HMAC signer + cross-process webhook client               |
| `src/adapters.js`                 | Per-agent claim instructions                             |
| `src/config.js`, `src/logger.js`  | Env config + stderr-only structured logging              |
| `tests/`                          | `node --test` unit + integration suite                   |

## Environment

| Variable                       | Default                                             |
|--------------------------------|-----------------------------------------------------|
| `TASKBRIDGE_DB_PATH`           | `./data/tasks.db`                                   |
| `TASKBRIDGE_WEB_HOST`          | `127.0.0.1`                                         |
| `TASKBRIDGE_WEB_PORT`          | `3000`                                              |
| `TASKBRIDGE_WEBHOOK_URL`       | `http://<host>:<port>/webhooks/task-events`         |
| `TASKBRIDGE_WEBHOOK_SECRET`    | `dev-secret-change-me` (change this!)               |
| `TASKBRIDGE_AGENT_ID`          | `generic`                                           |
| `TASKBRIDGE_DEBUG`             | unset                                               |

## MCP tools

| Tool                 | Purpose                                     |
|----------------------|---------------------------------------------|
| `list_pending_tasks` | Discover work                               |
| `get_task`           | Fetch one task                              |
| `claim_task`         | `pending → in_progress`, stamps `agent_id`  |
| `submit_result`      | `in_progress → done`                        |
| `fail_task`          | `* → failed`                                |
| `report_progress`    | Stream status update                        |

## How it works

You submit a prompt in the browser; the web server stores it as a `pending` row in SQLite. An MCP client calls `list_pending_tasks`, `claim_task`, does the work using its own tools, and calls `submit_result`. The MCP process HMAC-signs a webhook to the web server, which verifies the signature and pushes the update to the browser over SSE. The card flips from `pending` → `in_progress` → `done` in real time.
