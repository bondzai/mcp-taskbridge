# MCP Taskbridge

A tiny local bridge that lets you submit tasks from a browser and have **any MCP client** (Claude Desktop, Claude Code, Claude Cowork, …) execute them through the Model Context Protocol, with results streaming back to the UI via HMAC-signed webhooks.

```
[Browser] ─▶ [Web server] ─▶ SQLite ◀─ [MCP server] ◀─▶ [MCP client]
   ▲                                         │
   └────────── SSE ◀── webhook ◀─────────────┘
```

## Quick start

```bash
make install    # npm install
make test       # node --test tests/*.test.js — expect 72 / 72
make web        # http://127.0.0.1:3000
```

Then register `bin/mcp.js` in your MCP client and reload it — see [`docs/setup.md`](docs/setup.md).

`make help` lists every automation target (web, mcp, supergateway, tunnel, cowork, smoke, clean, fresh, check-deps, version, changelog, …).

## What you get

- **Modern UI** at `http://127.0.0.1:3000` — Bootstrap 5 + Bootstrap Icons, responsive GitHub-style navbar, three themes (light / dark / dim + auto), accordion task list with search / status filter / sort / pagination, per-task Rendered vs Raw markdown toggle, timestamp grid, live SSE updates, version badge with in-app changelog.
- **Prompt library** — wand icon in the navbar opens a modal with four best-practice prompt templates (solve-oldest, solve-this, triage, fail-with-reason); every task card has a one-click **Copy AI prompt** button that pre-fills the id and a preview.
- **Settings page** at `/settings.html` — theme picker, task-list defaults, read-only server info.
- **Two-process core** — an Express web server and a stdio MCP server that share one SQLite file and bridge state over HMAC-signed webhooks.
- **Agent adapters** — `TASKBRIDGE_AGENT_ID` picks tailored claim instructions per client.

## Agent adapters

| Adapter id       | For                    |
|------------------|------------------------|
| `claude-desktop` | Claude Desktop         |
| `claude-code`    | Claude Code CLI        |
| `claude-cowork`  | Claude Cowork          |
| `codex`          | OpenAI Codex           |
| `antigravity`    | Google Antigravity     |
| `generic`        | Any other MCP client   |

Unknown ids fall back to `generic`. The tool *schemas* are pure MCP — no client-specific assumptions — so any MCP client works.

## MCP tools

| Tool                 | Purpose                                     |
|----------------------|---------------------------------------------|
| `list_pending_tasks` | Discover work                               |
| `get_task`           | Fetch one task                              |
| `claim_task`         | `pending → in_progress`, stamps `agent_id`  |
| `submit_result`      | `in_progress → done`                        |
| `fail_task`          | `* → failed`                                |
| `report_progress`    | Stream a status update                      |

Full input / output / error contracts: [`docs/mcp-tools.md`](docs/mcp-tools.md).

## Environment

| Variable                       | Default                                             |
|--------------------------------|-----------------------------------------------------|
| `TASKBRIDGE_DB_PATH`           | `./data/tasks.db`                                   |
| `TASKBRIDGE_WEB_HOST`          | `127.0.0.1`                                         |
| `TASKBRIDGE_WEB_PORT`          | `3000`                                              |
| `TASKBRIDGE_WEBHOOK_URL`       | `http://<host>:<port>/webhooks/task-events`         |
| `TASKBRIDGE_WEBHOOK_SECRET`    | `dev-secret-change-me` *(change this for anything non-local!)* |
| `TASKBRIDGE_AGENT_ID`          | `generic`                                           |
| `TASKBRIDGE_DEBUG`             | unset                                               |

## Documentation

Start at [`docs/README.md`](docs/README.md) — the index for everything below.

- [`docs/setup.md`](docs/setup.md) — install, configure, register with an MCP client
- [`docs/architecture.md`](docs/architecture.md) — process topology, module layout, event bus, data model, trade-offs
- [`docs/mcp-tools.md`](docs/mcp-tools.md) — reference for all 6 MCP tools + error codes
- [`docs/api.md`](docs/api.md) — REST + SSE + webhook contracts, HMAC signature scheme
- [`docs/e2e-test.md`](docs/e2e-test.md) — HTTP-only + real-MCP-client walkthrough
- [`docs/cowork.md`](docs/cowork.md) — using taskbridge with Claude Cowork (HTTP tunnel + security)
- [`CHANGELOG.md`](CHANGELOG.md) — release history
