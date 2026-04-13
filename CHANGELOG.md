# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-04-13

### Added

- **Native `POST /mcp` Streamable HTTP endpoint** baked directly into
  the web server using the MCP SDK's `StreamableHTTPServerTransport`.
  Stateless, per-request: every `POST /mcp` spawns a fresh `McpServer`
  + transport, processes the JSON-RPC message, and tears them down on
  response close. No supergateway, no cloudflared, no cross-process
  HMAC webhook — tool calls emit directly on the in-process event bus
  that the SSE broadcaster already listens to. Cowork / Codex /
  Antigravity (HTTP path) can now point at `http://127.0.0.1:3000/mcp`
  with zero middleman. The existing stdio path via `bin/mcp.js`
  remains unchanged for Claude Desktop and any other stdio client.
- **Per-request, dynamic adapter detection.** The agent tag stamped on
  a claimed task is no longer a process-wide static value. Each
  `initialize` call has its `clientInfo.name` matched against a
  prioritized regex list (`codex`, `antigravity`, `claude-desktop`,
  `claude-code`, `claude-cowork`, `anthropic`, `openai`) and cached
  by `User-Agent + remote address`. Subsequent `tools/call` requests
  resolve through that cache, then a "last initialize seen" fallback,
  then the static `TASKBRIDGE_AGENT_ID` default. Explicit `agent_id`
  in `claim_task` arguments still wins above all of those. New module
  `src/core/client-detection.js` + 22 new tests for it.
- **Detection logging on stderr** — every detected client emits a
  structured JSON line (`mcp client detected`) including the raw
  `clientInfo.name`, the resolved adapter, and the originating
  User-Agent / IP, so future "why was this tagged X?" questions can be
  answered from the log.
- **Native /mcp test suite** — 8 new tests using a real `app.listen()`
  ephemeral port and raw `fetch` to drive the JSON-RPC: initialize
  handshake, `tools/list`, end-to-end `list → claim → submit`,
  unknown-id error mapping, SSE fanout from a `claim_task` made via
  HTTP, dynamic detection of `codex-mcp-client`, unknown-client
  fallback, and explicit `agent_id` override.
- **System status page** at `/status.html` — live health snapshot with
  colored banner, auto-refresh every 5 s, and per-component cards for
  the web server, database, task counts, event bus, SSE broadcaster,
  webhooks, and inferred MCP activity.
- **`GET /api/health`** — runtime snapshot used by the status page.
  Includes DB probe (task counts by status + `PRAGMA journal_mode`),
  SSE subscriber count, per-event-type timestamps, webhook counters
  (`received` / `rejected` / `lastOkAt` / `lastRejectedAt`), and an
  inferred `mcp.status` derived from recent signed-webhook activity
  (`active` ≤ 5 min, `idle` ≤ 1 h, else `unknown`). Three new node:test
  cases, bringing the suite to **75 / 75**.
- `src/core/health.js` — in-process metrics tracker subscribed to the
  event bus and threaded through `createApp({ repo, health, … })`.
- `repo.countByStatus()` + `repo.journalMode()` helpers.
- **Status** nav entry in the top navbar between Tasks and Settings.
- **Dynamic external-tool probes** on the status page. `/api/health`
  now returns an `external` array populated by a hardcoded list of
  per-request probes (no config file, no scheduler):
  - `supergateway` — POSTs an MCP `initialize` to
    `http://127.0.0.1:8000/mcp` and checks for a taskbridge `serverInfo`
    (`ok` / `warn` / `off` / `bad`).
  - `cloudflared` — runs `pgrep -f "cloudflared tunnel"` and reports
    how many processes matched (`ok` / `off`).
  - `mcp-clients` — mirrors the inferred `mcp.status` block so stdio
    MCP clients appear as a first-class card.
  Probes run in parallel with short timeouts (~1–1.5 s) so the
  `/api/health` response stays well under 2 s worst case. The status
  page renders them under a new "External tools" heading, and the
  top banner picks up the worst level across both sections.
- Three more `node:test` cases covering the probe runner, the
  stubbed-check integration through `/api/health`, and the
  "external is empty when no checks configured" default. Suite now
  at **82 / 82**.

### Changed

- `/webhooks/task-events` now increments accept / reject counters on
  every delivery so the UI can show signed-webhook health without
  parsing logs.
- **Makefile**: stopped silently clobbering `TASKBRIDGE_AGENT_ID`. The
  old `AGENT_ID ?= claude-cowork` + `export TASKBRIDGE_AGENT_ID = $(AGENT_ID)`
  pattern force-overwrote any shell-set value. The new Makefile uses
  `TASKBRIDGE_AGENT_ID ?= generic` + bare `export TASKBRIDGE_AGENT_ID`
  so `TASKBRIDGE_AGENT_ID=codex make web` actually works. Default
  fallback dropped from `claude-cowork` to `generic` since dynamic
  detection now handles real-world clients per-request.

### Fixed

- Codex Desktop ran a full task end-to-end successfully through the
  native `/mcp` endpoint but the browser badge showed `generic` instead
  of `codex`. Two layered bugs: (a) the Makefile was force-exporting a
  stale `TASKBRIDGE_AGENT_ID`, and (b) the original detection map only
  had exact-string matches so any clientInfo.name variant we hadn't
  seen ("Codex Desktop", "Codex.Desktop", …) silently fell through to
  fallback. Now resolved by the regex matcher + the
  "last initialize seen" cache fallback.

## [0.3.0] — 2026-04-13

### Added

- **Modern UI rewrite** using Bootstrap 5 + Bootstrap Icons via CDN.
- **Responsive top navbar** (GitHub-style): brand, Tasks / Settings tabs,
  live pending-count badge, theme dropdown, settings gear, external link.
- **Three themes**: `light`, `dark`, `dim` (GitHub-style soft dark), plus
  `auto` that follows `prefers-color-scheme`.
- **Settings page** (`/settings.html`):
  - Theme picker with swatches.
  - Task-list defaults: page size, status filter, sort order.
  - Read-only server info pulled from `GET /api/config`.
  - Reset-to-defaults button.
- **Accordion task list** with search, status filter, sort
  (newest / oldest / recently-updated / by-status), pagination.
- **Timestamp grid** inside each expanded task: Created / Updated /
  Claimed / Completed, with relative time shown and absolute time on hover.
- **Rendered / Raw markdown toggle** per task — prompts, results, progress
  and errors can be viewed as rendered GFM or as raw preformatted text,
  similar to the GitHub markdown viewer.
- **Version badge** in the navbar — clicking it opens a modal that
  renders this changelog.
- **`GET /api/config`** route returning non-secret runtime config
  (`agentId`, `webhookUrl`, `webHost`, `webPort`, `version`).
- **`GET /api/changelog`** route that serves `CHANGELOG.md` as
  `text/markdown` for the in-app changelog modal.
- **Makefile** with self-documenting targets: `install`, `rebuild`,
  `test`, `web`, `mcp`, `supergateway`, `tunnel`, `cowork`, `smoke`,
  `smoke-mcp`, `clean`, `fresh`, `check-deps`, `version`, `changelog`.
  Run `make` or `make help` to see everything.
- **Prompt library** (wand icon in the navbar, plus per-task shortcut)
  with four best-practice templates users can copy into Cowork / Claude
  Desktop / any MCP client:
  1. *Solve oldest pending task* — list → claim → work → submit.
  2. *Solve this specific task* — id pre-filled from the task card.
  3. *Triage pending queue* — read-only, categorizes without claiming.
  4. *Fail a task with a reason* — for unsafe / duplicate / out-of-scope.
  Each template has editable variables, a live preview with char / word
  count, and a one-click Copy button (clipboard API with textarea
  fallback). Every task card also gets a **Copy AI prompt** button that
  one-click-copies the "solve this" template with the id and a 500-char
  prompt preview already filled in.

### Changed

- `docs/cowork.md` rewritten with a verified, working setup:
  the three load-bearing supergateway flags
  (`--outputTransport streamableHttp`, `--protocolVersion 2025-03-26`,
  `--cors`), an architecture diagram, a public-URL curl smoke test,
  and a "nothing happens after toggle is normal" troubleshooting row.
- `bin/web.js` now reads `package.json` to expose the version to the UI
  via `/api/config`.

### Fixed

- Documented `npm rebuild better-sqlite3` after switching Node versions.
- Documented the `node --test tests/*.test.js` workaround for the
  `npm test` script on Node 24+ (bare `tests/` is resolved as a module
  path in newer Node releases).

## [0.2.0] — 2026-04-12

### Added

- Initial public release of **mcp-taskbridge**.
- stdio **MCP server** exposing six tools:
  `list_pending_tasks`, `get_task`, `claim_task`, `submit_result`,
  `fail_task`, `report_progress`.
- SQLite-backed task repository with pending → in_progress → done / failed
  state transitions and atomic claim.
- Express **web server** with HMAC-signed webhook receiver and an
  in-process SSE broadcaster for live browser updates.
- Agent adapters: `claude-desktop`, `claude-code`, `claude-cowork`,
  `generic`, each with its own claim instructions.
- `node --test` suite: **72 tests** covering repo, service, HTTP routes,
  webhook signer, MCP tools, and an end-to-end stdio integration test.

[0.3.0]: #030--2026-04-13
[0.2.0]: #020--2026-04-12
