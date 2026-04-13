# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.1] — 2026-04-13

### Fixed

- **Codex Desktop tasks were tagged `generic` instead of `codex`** even
  with the dynamic detection from 0.4.0 in place. Root cause: Codex
  Desktop's `initialize` message carried a `clientInfo` object with
  no `name` field, so the existing detector had nothing to match on
  and the task fell through to the static `TASKBRIDGE_AGENT_ID`
  fallback (which is now `generic`).

  Fix is layered:
  1. **`createClientTracker.observe()`** — when `initialize` arrives
     with an empty / missing `clientInfo.name`, it now falls back to
     pattern-matching the HTTP `User-Agent` header instead. The cache
     entry it writes is still keyed on `User-Agent + remoteAddress`,
     so subsequent `tools/call`s on the same connection find it.
  2. **`createClientTracker.resolve()`** — even when no initialize
     was ever observed, every request now also pattern-matches its
     own `User-Agent` header. So a `tools/call` arriving on a fresh
     TCP connection still resolves correctly without a prior init.
  3. **Stdio MCP path is now dynamic too**. After
     `await server.connect(transport)` in `startStdioMcpServer()`,
     we read `server.server.getClientVersion()?.name` and call
     `handlers.setAdapterId(detected)` to re-bind the claim agent.
     Means a Codex / Claude Desktop / Antigravity user who registers
     `node bin/mcp.js` without setting `TASKBRIDGE_AGENT_ID` still
     gets the right tag.
  4. **`createToolHandlers`** now exposes `setAdapterId(id)` and
     reads the adapter at call time (closure variable instead of
     captured-at-creation). Prepared for future late-binding cases.
  5. **Diagnostic logging** — every detection path now emits a
     structured log line:
     - `mcp client detected` (with `source: clientInfo.name | user-agent`)
     - `mcp client resolved via user-agent` (UA fallback in resolve())
     - `mcp client fallback` (no signal at all → static default)
     So the next time someone sees an unexpected agent tag, the
     web server's stderr has the exact reason.
  6. Cleanup of 107 zombie `bin/mcp.js` processes that supergateway's
     stateless mode left behind.

### Added

- **Run details section now always renders for terminal tasks**, with
  `—` placeholders when model / tokens are missing. A small inline
  hint explains how to populate them: "your MCP client should pass
  `model` / `tokens_in` / `tokens_out` on `submit_result`". The
  prompt-library templates (`solve-oldest`, `solve-this`) have been
  updated to nudge agents to do exactly that.
- `adapterForUserAgent(userAgent, fallback)` — exported helper that
  pattern-matches against an HTTP User-Agent string. Re-uses the
  same priority-ordered regex list as `adapterForClientName`.
- 2 new tests: UA-only resolve without a prior initialize; observe
  on initialize with empty `clientInfo` falls through to UA matching.
  Suite now **124 / 124**.

## [0.5.0] — 2026-04-13

### Added

- **Task lifecycle management — update / archive / unarchive / delete**:
  - `PATCH /api/tasks/:id` updates the prompt while a task is still
    `pending`. Once claimed, the prompt is locked.
  - `POST /api/tasks/:id/archive` and `POST /api/tasks/:id/unarchive`
    soft-delete and restore. Archived tasks are hidden from the default
    `GET /api/tasks` response unless `?include_archived=true` is passed.
    Both endpoints are idempotent.
  - `DELETE /api/tasks/:id` hard-deletes. Use archive for reversible
    removal.
  - New SSE event types: `task.updated`, `task.archived`,
    `task.unarchived`, `task.deleted`.
- **Per-task action buttons** in the dashboard accordion:
  Edit (only while pending — opens an inline textarea + Save / Cancel),
  Archive (Bootstrap toast + the card hides unless "Show archived" is
  toggled), Delete (browser confirm prompt then hard-delete via SSE
  fanout, the card vanishes from the UI in real time across every open
  browser tab).
- **"Show archived" toggle** in the toolbar — re-fetches the list with
  `?include_archived=true` so archived items reappear with an
  Unarchive button. Each archived row gets a low-opacity treatment
  and an "archived" pill alongside its status.
- **Run details section** in each task body — shown when any of model,
  tokens, or processing-time data is available:
  - **Processing time** is a derived field — no new column. Computed
    from existing timestamps as **time waiting** (`claimedAt − createdAt`),
    **time working** (`completedAt − claimedAt`), and **total elapsed**
    (`completedAt − createdAt`). Formatted as `123 ms` / `4.2 s` /
    `2m 14s` / `1h 3m 12s` depending on magnitude.
  - **Model** + **tokens** (in / out / total) are surfaced when the
    MCP client passes them on `submit_result`. Optional — if a client
    doesn't supply them, the section quietly hides.
- **`submit_result` MCP tool extended** with four optional fields:
  `model`, `tokens_in`, `tokens_out`, `total_tokens`. `total_tokens`
  is auto-computed from `tokens_in + tokens_out` when both are set
  but the client omits it. All four pass through validation
  (non-negative integers, length-capped model string).
- **Schema migration** in `src/core/db.js` — additive, idempotent
  `ALTER TABLE ADD COLUMN` for `archived_at`, `model`, `tokens_in`,
  `tokens_out`, `total_tokens`. Runs once per `openDatabase()`,
  no data loss, safe on existing dev databases.
- **+13 new tests** in `tests/lifecycle.test.js`: PATCH happy path,
  PATCH 409 when in_progress, PATCH 400 on empty/oversize input, PATCH
  404, archive idempotency + list-filter behaviour, unarchive,
  `listPending` excludes archived, DELETE round-trip + `task.deleted`
  emission, DELETE 404, complete-with-metadata happy path,
  explicit-total override, bad-token rejection, no-metadata baseline.

### Changed

- `src/core/repo.js` — `complete()` accepts an optional `metadata`
  object and `COALESCE`s the new columns so passing `null`s leaves
  existing values intact. `listAll()` takes `{ includeArchived }`.
- `listPending()` and `listByAgent()` now filter `archived_at IS NULL`.
- Task row shape gained `archivedAt`, `model`, `tokensIn`, `tokensOut`,
  `totalTokens`. The existing `result` / `error` / `progress` /
  timestamp fields are unchanged.

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
