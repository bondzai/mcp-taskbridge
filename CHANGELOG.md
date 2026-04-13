# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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
