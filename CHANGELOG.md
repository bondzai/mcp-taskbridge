# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.9] — 2026-04-30

### Changed

- **Domain badge — neutral white-smoke tone.** Dropped the per-domain
  colored variants (pharma purple, construction amber, etc.). Single
  base style now uses `--tb-surface-alt` background, `--tb-muted` text,
  `--tb-border` outline — clean, theme-aware, no overrides per domain.

## [1.4.8] — 2026-04-30

### Added

- **Domain badge** on each Purchase History row. Mock-history entries
  now carry a `domain` field (`construction`, `electrical`, `plumbing`,
  `facilities`, `safety`, `pharma`) rendered as a small uppercase pill
  next to the title. Per-domain accent (subtle muted hue) keyed by a
  single `.tb-domain-<name>` CSS class — DRY, theme-aware (light/dim/
  dark variants), no JS lookup required.

## [1.4.7] — 2026-04-30

### Demo data

- Added 5 pharmaceutical-domain entries to `MOCK_HISTORY` (Thai
  context):
  - APIs (Paracetamol, Amoxicillin, Metformin) — ไทยเอพีไอ / Siam Bioscience
  - Primary packaging (vials, ampoules, stoppers) — GlassPack Asia / Thai Glass
  - Excipients (MCC, lactose, mag stearate) — Bangkok Pharma Excipients
  - QC reagents & reference standards — Merck Thailand / LabKit Asia
  - Blister packaging — Thai Blister Pack / PrintPack BKK

  Visible on `/history.html` after the next deploy.

## [1.4.6] — 2026-04-30

### Fixed

- **PR detail page header bleed-through.** The header was sticky at
  `top: 48px` but the navbar's actual height is ~52px, leaving a
  4-pixel sliver where scrolled content showed above the header.
  Dropped the sticky behavior — short header, used once per page,
  matches the other pages.

### Demo data

- 4 pharmaceutical-domain mock PRs seeded to prod via the existing
  `bin/mock-prs.js --llm --industry "..."` CLI: APIs, packaging
  materials, QC reagents, excipients — Thai-context vendor names where
  natural.

## [1.4.5] — 2026-04-30

### Fixed

- **Bogus `pending → pending` row in timeline.** `startSourcing` was
  writing a status-log entry with `from === to` to record "sourcing
  task queued" — useful trace, but it rendered as a confusing
  same-status "transition" in the History tab. Removed the redundant
  log write; the underlying `transition()` still updates
  `sourcing_task_id`. Also added a client-side filter so existing rows
  in the DB are hidden from the timeline.

## [1.4.4] — 2026-04-30

### Fixed

- **Processing badge spin in history/system timeline.** The 1.4.3 fix
  only covered `.tb-pill-in_progress`, but procurement status pills use
  the separate `.tb-pill-processing` class (with its own `bi-arrow-
  repeat` spinner rule) — so historical "→ processing" entries kept
  spinning. Selector now covers every animated pill class
  (`.tb-pill-processing`, `.tb-pill-awaiting_reply`,
  `.tb-pill-rfx_in_progress`, `.tb-pill-in_progress`) and adds
  `!important` so it wins specificity battles with the per-class spin
  rules.

## [1.4.3] — 2026-04-30

### Fixed

- **Status timeline — historical "in_progress" pills no longer animate.**
  The pulse + spinner was global to `.tb-pill-in_progress`, so older
  entries kept moving even though the status was no longer current.
  Animations are now scoped to `.tb-timeline-item-latest` only.
- **Vendor pageSize / view reset bug.** Clicking *Deactivate* (or
  anything that triggered a `loadVendors()` re-render) reset pageSize
  back to 10 and view back to "list" — `renderToolbar()` was reading
  from a `persisted` snapshot captured at init, then overwriting the
  current state on every render. Replaced with init-only defaults so
  state survives re-renders.

### Changed

- **Default currency reverted to USD** (was THB in 1.3.6). Existing
  user choices in `localStorage` are still respected.

## [1.4.2] — 2026-04-30

### Removed

- **Duplicate PR** feature dropped — button on PR detail page, the
  `POST /api/procurement/prs/:id/duplicate` route, and
  `service.duplicatePr()`. Use the new **Import** flow if you need to
  copy a PR.

### Changed

- **PR list — Delete is now an icon-only button** on the right side of
  each card's action row. Compact red-tinted `tb-icon-btn-danger`
  variant for the trash icon, light hover state, theme-aware
  (red `#cf222e` light / `#e5534b` dark/dim). Pushed right via
  `ms-auto` so it sits opposite the Approve/Reject/Edit cluster.

## [1.4.1] — 2026-04-30

### Fixed

- **`CHANGELOG.md not found` on prod** — `.dockerignore` excluded
  `*.md`, so the file never reached the Cloud Run image. Whitelisted
  `CHANGELOG.md` and `README.md` (`!CHANGELOG.md`, `!README.md`) so the
  changelog modal renders properly after the next deploy.

### Changed

- **PR detail tab** "System" renamed to **History**.
- **Changelog modal** — removed the "Raw" button (the same content is
  rendered as Markdown right above; no need for a second link).

## [1.4.0] — 2026-04-30

### Changed

- **PR detail tabs reorganized** to match the natural read order:
  - **Summary** (new) — Agent Sourcing Report on top, Vendor Shortlist
    underneath (deduped per vendor).
  - **Items** — line-item table.
  - **RFx** — now a card per vendor showing **the items requested
    inside that RFx** (line-item names + quantities), the status,
    timestamps, payload + Open buttons. Replaces the flat table.
  - **System** — debug/audit drawer: Status Timeline, Quote Comparison,
    Agent Debug Log. Subsumes the old Quotes tab and pulls Timeline
    out of the front-of-house tabs.
- The old **Sourcing** and **Quotes** tabs are gone (their contents now
  live under Summary and System respectively).

### Fixed

- **Vendor dedup on AI sourcing** — when the agent submits a `vendor`
  object whose email matches an existing vendor row, the system now
  reuses that row (case-insensitive email lookup) instead of creating
  a near-duplicate. Logged in the debug log as `vendor_dedup_hit`.
  New repo method `vendors.getByEmail()`.

## [1.3.6] — 2026-04-30

### Changed

- **Default currency is now THB** (was USD). New users land on THB; users
  who already chose a currency keep it (`localStorage` preserved).
- **List controls: shared "Clear" button** appears in the toolbar
  whenever search / filters / sort differ from defaults. One click
  resets to the first-option filter values, default sort, and empty
  search. Doesn't touch view mode or page size (those stay as user
  preference). Same component is reused on Dashboard, Vendors, and
  Purchase History — so the affordance is consistent everywhere.
- Default PR sort confirmed as **Recently updated** (from 1.3.4); the
  Clear button is the easy escape for users still on the old "newest"
  preference saved before the change.

## [1.3.5] — 2026-04-30

### Changed

- **Timeline timestamps now include seconds** — `2026/04/29 09:04:57`.
- **`/api/config.version` is now live** — reads `package.json` on each
  request instead of freezing the value at boot. Lets bumps propagate
  without a manual restart.
- **`make dev` enables hot-reload** via `node --watch` on `src/`, `bin/`,
  and `package.json`. The web process auto-restarts on edits, so the
  version badge (and everything else) reflects local changes in seconds.

## [1.3.4] — 2026-04-30

### Changed

- **Status timeline shows absolute time** in `YYYY/MM/DD HH:MM` format
  alongside the relative "5 min ago". Easier to scan across days.
  New `dateTimeShort()` helper in `chrome.js`.
- **Default PR sort** is now **Recently updated** (was Newest first).
  Sort menu reorders so it sits at the top.
- **Purchase history is now an accordion.** Each PR row collapses by
  default, showing title + completion date + item count + vendors +
  total. Click to expand the full per-item table. Native `<details>`
  for accessibility — no JS for the toggle.

## [1.3.3] — 2026-04-30

### Fixed

- **Approve button on PR detail page** posted no body, so the server
  rejected with `approved_by must be a string`. Now reads the current
  user from `/api/auth/me` and sends `{approvedBy}`.
- **Stat-card filter** clicked once but acted N times. `renderStats()`
  was attaching a fresh click listener every render — listeners stacked
  up and toggled the active phase repeatedly. Bound once at boot.
- **Vendors page "Invalid Date"** in prod. `created_at` from Postgres
  BIGINT comes back as a string; `new Date("1773…")` returned NaN.
  Centralized `formatDate()` coerces to `Number()` and guards against
  NaN before formatting.

### Changed

- **Vendor list redesigned** more compact and minimal — single-row
  header (name · email · categories · lead-time · materials count ·
  added-on) with icon-button actions on the right and an overflow
  dropdown for activate/deactivate. Less padding, less visual noise.
  New CSS class `.tb-vendor-row` (and `.tb-pill-info` shared with the
  AI-sourced badge).

## [1.3.2] — 2026-04-30

### Changed

- Brand mark redesigned in **red & white** — a `#dc2626` rounded square
  with a white shopping-cart glyph (Bootstrap-icons `cart3` path embedded
  inline). Replaces the bare 🛒 emoji so the colors render the same on
  every OS / theme. `.tb-mark` (1.4em) for inline use, `.tb-mark-lg` for
  the login screen, and the navbar `.tb-logo` shares the same look.
  Favicons regenerated to match.

## [1.3.1] — 2026-04-30

### Changed

- Brand styling aligned with the procurement-mail service. Logo is now
  the 🛒 emoji (sibling to mail's 📮), brand string is `procurement-core`.
  Inline-SVG favicon added to every HTML page, matching the mail-service
  pattern (no asset files needed).

## [1.3.0] — 2026-04-29

### Added

- **Status hierarchy doc** (`docs/status-model.md`) — three-layer model
  (PR → PR item → RFx item), unified vocabulary, roll-up rules, state
  diagrams, and webhook contracts.
- **`POST /webhooks/rfx-item-status`** — mail service can push RFx-item
  status updates `{rfxId, lineItemId?, status, occurredAt, detail?}`.
  Statuses: `pending_send | awaiting_reply | replied | expired |
  completed | cancelled`. Audit-logged in `rfx_event_log` and mapped
  onto the existing `rfq_emails.status` column for now (until a
  dedicated `pr_rfx_items` table lands).
- **`POST /webhooks/pr-item-status`** — mail service can push PR-item
  status updates `{prId, lineItemId, status, occurredAt, reason?}`.
  Statuses: `pending_rfx | rfx_complete | cancelled`. Idempotent on
  same status. Re-runs `recomputePrStatus()` so the PR-level status
  follows automatically.
- New service method `applyPrItemStatus()` that wraps the per-item
  update + recompute in one call.

Both webhooks live under `/webhooks/`, skip auth middleware, and use
permissive HMAC during bring-up (verify when secret + signature are
both present, accept otherwise).

## [1.2.3] — 2026-04-29

### Changed

- Dashboard buttons renamed for clarity:
  - **Mock Doc** → **Download example**
  - **From File** → **Upload file**

### Added

- **Non-PR upload validation.** The LLM extractor now returns
  `{isPurchaseRequest, rejectionReason}`. When the file isn't a PR
  (essay, README, blank, contract, etc.) the server responds `422`
  with `code: "NOT_A_PR"`, and the UI surfaces a Bootstrap modal
  explaining the rejection rather than letting through an empty PR.

## [1.2.2] — 2026-04-29

### Fixed

- **PR auto-completion now broadcasts in real time.** `recomputePrStatus`
  used to mutate the row silently — dashboard / detail pages had to be
  manually refreshed to see the transition. Now emits `PR_UPDATED`
  (always) and `PR_COMPLETED` / `PR_CANCELLED` (when applicable) so SSE
  listeners refresh in place.
- Dashboard subscribes to `pr.sourced` (was missing). Detail page also
  refetches the PR on every PR-related event so the latest persisted
  shape is rendered.

### Added

- `ProcurementEvents.PR_UPDATED` constant (`pr.updated`).

### Config

- `OPENAI_API_KEY` added to `.env.production` and `.env.local`. Both
  files are gitignored. Run `./deploy.sh` to ship the key to Cloud Run.

## [1.2.1] — 2026-04-29

### Fixed

- **`POST /api/procurement/prs/from-file`** now returns `503` with code
  `LLM_NOT_CONFIGURED` when the LLM provider can't initialize (e.g.
  `OPENAI_API_KEY` missing on the server). Was returning a confusing 500.
- `/api/config` exposes `llmConfigured` (bool). Dashboard disables the
  **From File** button with a clear tooltip when the server has no key —
  instead of letting the user click straight into an error.

## [1.2.0] — 2026-04-29

### Added

- **Mock PR document download** — `GET /api/procurement/mock-pr-document`
  generates a realistic, RFP-style `.txt` requisition. Dashboard has a
  new **"Mock Doc"** button that downloads it; pair with **From File**
  for an LLM round-trip demo.
  Helper: `renderMockPrDocument(pr)` in `src/procurement/mock-prs.js`.
- **Currency switch (USD ↔ THB ↔ …).** Pluggable provider abstraction
  (`src/currency/provider.js`) with **frankfurter.app** as the default
  free, no-key implementation. In-process cache with TTL (1 h),
  stale-while-revalidate, hardcoded floor fallback for outages, and
  request timeout (5 s).
  - `GET /api/currency/rates?base=USD` → `{base, rates, fetchedAt, source, stale}`
  - Header dropdown picker, persists in `localStorage` (`settings.currency`).
  - `formatMoney(amount, from)` helper in `chrome.js` does on-the-fly
    conversion at render time. Stored prices stay in their native currency.
  - Detail page re-renders when the currency changes (`tb-currency-changed`
    event).

## [1.1.6] — 2026-04-29

### Fixed

- **Mail-service `deadline` always a number-or-null.** ISO date strings,
  numeric strings, NaN, and `undefined`/empty are all coerced before send.
  Mail service was returning `"deadline must be a number (epoch ms) or null"`
  when an ISO string slipped through.

### Added

- **Payload debug button** on each RFx row (PR detail → RFx tab).
  The braces (`{}`) icon expands an inline panel showing the JSON payload
  we sent to the mail service plus every persisted send response (status
  code, body, error). Cached per page-load so toggling is instant.

## [1.1.5] — 2026-04-29

### Changed

- **Mail-service payload now has a stable shape.** Every documented key
  (`requestedBy`, `deadline`, `notes`, `vendor.email`, `vendor.phone`,
  `vendor.address`, `vendor.leadTimeDays`, item `specification`/
  `referencePrice`, etc.) is always present in the JSON. Missing values
  are explicit `null` (or `[]` for arrays) instead of being dropped by
  `JSON.stringify`. Added `notes` (PR-level) to the payload as well.

## [1.1.4] — 2026-04-29

### Added (internal debug — clean later)

- **`rfx_send_log` table** persists every mail-service send response per RFx
  (status code, response body, error, vendor summary). Survives container
  restarts so we can debug what the email service returned even after
  Cloud Run scales to zero.
- New repo `createRfxSendLogRepository` + service method `listRfxSendLog(prId)`.
- New endpoint `GET /api/procurement/prs/:id/rfx-send-log` returns the
  log entries newest-first for a given PR.
- `email-client.sendBatch` now returns structured failures (`statusCode`,
  `response`, `error`) instead of throwing, and includes a `payload`
  reference so the caller can build the persisted summary.

## [1.1.3] — 2026-04-29

### Changed

- Outgoing mail-service payload now defaults `rfxTypes` to `["RFI","RFQ"]`
  when the agent didn't supply a value (or supplied an empty array).
  Previously it was `[]`, leaving the mail service with no instruction.

## [1.1.2] — 2026-04-29

### Fixed

- **Shortlist no longer wiped between agent calls.** `insertShortlist`
  used to `DELETE FROM pr_vendor_shortlist WHERE pr_id = ?` before each
  insert batch, so an agent that submitted vendors across multiple
  `submit_vendor_shortlist` calls (one per item) would lose all but the
  last batch. Behaviour is now append-and-dedupe by
  `(vendor_id, line_item_id)`.
- **Sourcing prompt strengthened** to make the "all-or-nothing" rule of
  the decision engine explicit: if any line item has zero vendors in the
  call, the whole batch is rejected and zero RFx emails go out. Listing
  externals only in `submit_result` markdown is now flagged as a no-op.

## [1.1.1] — 2026-04-29

### Fixed

- **Orphan sourcing tasks after PR delete.** `service.deletePr` now also
  deletes the linked sourcing task (via `purchase_requests.sourcing_task_id`).
  `bin/delete-all-prs.js` cleans every sourcing task as well. Previously,
  deleting a PR left its task in the queue — `list_pending_tasks` would
  return phantom tasks whose embedded title (e.g. "IT hardware refresh")
  no longer matched any existing PR, confusing the agent and the UI.

## [1.1.0] — 2026-04-29

### Added

- **JSON export / import** for purchase requisitions (per-PR + bulk).
  Endpoints: `GET /api/procurement/prs/export`, `GET /api/procurement/prs/:id/export`,
  `POST /api/procurement/prs/import`. Dashboard buttons added.
- **Create PR from PDF/TXT** via LLM extraction. New `src/llm/` provider
  abstraction (`extractPrFromDocument`, `generatePrs`); OpenAI implementation
  configured via `LLM_PROVIDER` + `OPENAI_API_KEY`. Endpoint
  `POST /api/procurement/prs/from-file` — extracted JSON pre-fills the form.
- **Reusable mock-PR generator** (`src/procurement/mock-prs.js`) + CLI
  `bin/mock-prs.js`. Supports DB-direct + HTTP API modes, optional
  `--llm` for LLM-driven variety, `--industry <hint>`, `--seed <int>`.
- **RFx webhook endpoint** `POST /webhooks/rfx-events` (mail-service → core).
  Persists to new `rfx_event_log` table (idempotent on
  `(rfx_id,event,occurred_at)`), updates `rfq_emails.status`, broadcasts
  `rfx.event` on SSE. Permissive HMAC during bring-up.
- **External RFx links** — `RFX_EXTERNAL_BASE_URL` env (default
  `https://freeform-agents.web.app/rfx`) exposed via `/api/config`. The PR
  detail → RFx tab now has an **Open ↗** button per RFx row.
- **Edit / Delete** actions on PR cards in the dashboard list.
- **Generate mock PRs** template in the prompt library (top-right wand icon).
- **`rfxTypes` field** in outgoing mail-service payload, sourced from the
  agent's `submit_vendor_shortlist` call. Defaults to `[]`.

### Changed

- Renamed nav tab + dashboard heading to **"Purchase Requisitions"**.
- Renamed PR detail tab **"RFQ" → "RFx"**.
- Removed PR-level `draft` status; PRs are created directly in
  `pending_approval`. Helper script `bin/delete-drafts.js` cleans legacy rows.
- Cloud Run defaults switched to demo profile: `--min-instances 0`,
  `--max-instances 1`, `--cpu-throttling`, `--no-session-affinity`.
- Postgres schema applies idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS`
  migrations on every container start, so column additions reach Supabase
  without manual SQL.
- UI: status timeline now reads camelCase fields, items table shows vendor
  names instead of raw UUIDs, multi-vendor pills per item.

### Fixed

- `submit_vendor_shortlist` 500 on prod ("column rfx_types does not exist"):
  added migration ALTERs to `schema.sql`.
- Dashboard PR cards refresh correctly when status updates arrive over SSE.

### Database

- New table `rfx_event_log`.
- New column `pr_vendor_shortlist.rfx_types` (JSON-encoded array).

## [1.0.0] — 2026-04-29

First production release. Rebranded from `mcp-taskbridge` to `procurement-agent`.

### Added

- **Procurement domain module** (`src/procurement/`) — full PR lifecycle:
  - 8 SQLite tables: vendors, vendor_materials, purchase_requests,
    pr_line_items, pr_vendor_shortlist, rfq_emails, vendor_responses,
    pr_status_log, pr_item_status_log
  - 7 PR statuses: `draft`, `pending_approval`, `pending`, `processing`,
    `failed`, `completed`, `cancelled`
  - 7 item-level statuses: `draft → sourcing → quoted → selected → ordered → received`
  - Per-item audit trail with notes
- **MCP tools for sourcing agents**:
  - `search_vendors`, `get_vendor_details`, `list_vendor_materials`
  - `get_purchase_request`, `get_pr_line_items`, `get_purchase_history`
  - `submit_vendor_shortlist`, `update_item_status`
- **Decision engine** — pure rule-based validation of vendor shortlists
  with coverage/price/min-vendor/deadline checks.
- **RFQ payload builder** — generates JSON for the email service
  (one payload per vendor, items merged).
- **Email service HTTP client** (`src/procurement/email-client.js`) —
  POSTs RFQ payloads to a configurable endpoint with `X-API-Key` auth.
  Mock mode when `EMAIL_SERVICE_URL` is unset.
- **Auth system** — cookie-based session auth with HMAC-signed tokens,
  mock admin/viewer users, login page, navbar avatar dropdown.
- **Cloud Run deployment** (`Dockerfile`, `deploy.sh`,
  `docker-compose.yml`).
- **Database abstraction layer** (`src/db/`) — adapter interface
  supporting both SQLite (local + tests) and PostgreSQL/Supabase
  (production). Single batch queries, no N+1.
- **Web UI overhaul**:
  - Dashboard with clickable stat cards (filter by phase)
  - Inline PR creation form (no separate page)
  - Per-item status timeline + comparison table
  - Purchase History (read-only, mock data)
  - Vendor management with KPI dashboard
  - Live SSE updates with `res.flush()` for Cloud Run compatibility
- **Duplicate / Reprocess PR** actions for quick testing.
- **Mock purchase history** (`src/procurement/mock-history.js`) —
  read-only reference data decoupled from PRs.
- **Seed script** (`bin/seed.js`) with vendors, materials, and PRs.

### Changed

- Rebranded from "MCP Taskbridge" to "Procurement Agent" across
  navbar, page titles, footer, prompts, and adapter instructions.
- Approve action auto-creates the sourcing task (no manual
  "Start Sourcing" button).
- PR moves to `processing` automatically when an agent claims the
  sourcing task (via `task.claimed` event + metadata.prId).
- Repos and services converted to async (adapter interface).
- Dashboard merged "Tasks" view into the unified PR list.

### Fixed

- `/api/auth/me` was 401 on a public path — now verifies the cookie
  token directly.
- Task `metadata` was being interpreted as `files` parameter,
  silently dropped. `service.create(prompt, metadata)` now correctly
  distinguishes arrays (files) from objects (metadata).
- N+1 query when listing PRs — replaced with single batch query.
- SSE buffering on Cloud Run — added `res.flush()` after every write
  + `Content-Encoding: identity` header.
- Cloud Run `PORT` env var support — config now reads `process.env.PORT`
  and binds to `0.0.0.0` instead of `127.0.0.1`.

### Production

- Deployed as `procurement-core` on Cloud Run (asia-southeast1).
- Database: Supabase PostgreSQL via direct connection.
- Email service: Cloud Function at
  `https://asia-southeast1-freeform-agents.cloudfunctions.net/procurement_mail_api/rfqs`.

## [0.6.1] — 2026-04-13

### Changed

- **Prompt library refactored to composable building blocks.**
  `src/transport/http/public/assets/prompts.js` no longer has four
  long, near-duplicate template strings. Reusable wording lives in
  one frozen `PROMPT_FRAGMENTS` object — `role`, `taggingNote`,
  `resultFormat`, `metadataNudge`, `failureRule`, `stateOnlyRule` —
  and each template is a `compose([...sections])` of named blocks.
  Net effect:
  - The "metadata nudge" paragraph (`model` / `tokens_in` / etc.)
    lives in **one place**, not three.
  - The tagging note and the failure rule are likewise single-source.
  - Templates went from 80+ lines of inline backtick markdown to
    short data structures + small `tplX()` builders.
  - No more hardcoded agent ids, no more `WORKER_ID` placeholder
    leftovers from earlier rounds.
- **Public API of `prompts.js`** now also exports `PROMPT_FRAGMENTS`
  so tests (and any future tooling) can introspect the shared blocks.
- **`buildPrompt(...)` no longer double-trims** — `compose()` already
  guarantees a single trailing newline.

### Added

- **Running-task animations** for `in_progress` cards:
  - **Pulsing status pill** with a soft cyan halo
    (`@keyframes tb-pulse-pill`) and a continuously-spinning
    `arrow-repeat` icon.
  - **Animated "working dots"** (`...`) next to the status text.
  - **Glowing border** around the entire `in_progress` accordion
    item via a `::before` pseudo-element with a 2.4 s breathing
    box-shadow.
  - **Live elapsed timer pill** in the meta row that ticks once
    per second using an in-place text mutation — does **not**
    re-render the accordion, so expanded panels don't collapse.
    Format adapts: `42 ms` → `4.2 s` → `2m 14s` → `1h 3m 12s`.
- **State-transition flashes**:
  - `task.created` → 0.32 s slide-in (`@keyframes tb-slide-in`).
  - `task.completed` → 1.6 s green wash on the accordion header
    (`@keyframes tb-flash-done`).
  - `task.failed` → 1.6 s red wash (`@keyframes tb-flash-failed`).
  - `task.deleted` / `task.archived` (when "Show archived" off) →
    0.32 s fade-out + collapse (`@keyframes tb-fade-out`) before
    the model is mutated, so the card visibly disappears instead
    of popping out.
- All animations are gated by `@media (prefers-reduced-motion: reduce)`
  and disabled for users who've asked the OS to suppress motion.
- **`tests/prompts.test.js`** — 12 new tests covering the refactored
  prompt library: shape of every template, ids unique, all four
  templates build to non-empty output, shared fragments are actually
  shared (the DRY assertion), variable interpolation, optional
  blocks (preview), error on unknown id. Suite now **141 / 141**.

## [0.6.0] — 2026-04-13

### Added

- **Per-URL adapter routing — `POST/GET/DELETE /mcp/<adapterId>`.**
  The agent id is taken straight from the URL path. No detection,
  no env vars, no prompt-level hardcoding. Each MCP client gets its
  own "lane" by registering a different URL:
  - `http://127.0.0.1:3000/mcp/codex` → tag `codex`
  - `http://127.0.0.1:3000/mcp/claude-cowork` → tag `claude-cowork`
  - `http://127.0.0.1:3000/mcp/my-bot` → tag `my-bot`
  Path segment is validated against `/^[a-z0-9][a-z0-9_-]{0,63}$/i`.
  Bad / missing / oversize segments → 400 with a JSON-RPC error.
- **Custom adapter ids are now first-class.** `createToolHandlers`
  tracks the raw id used for `claim_task` separately from the
  resolved registry adapter. Unknown ids — like `my-bot-7` — pass
  straight through as the agent tag instead of being normalised to
  `generic`. The registry is still consulted for the `instructions`
  string returned in the claim response (unknown ids fall back to
  the generic instructions text).
- **Five new tests** in `tests/http-mcp-native.test.js`:
  - `/mcp/:agentId` tags the task with the URL path adapter id.
  - `/mcp/:agentId` works with a brand-new custom name with no
    pre-existing registry entry.
  - Path traversal / weird characters → 404 or 400 (both safe).
  - Empty / oversize agent id → 400.
  - Explicit `agent_id` arg in `claim_task` still wins over the URL.

### Changed

- **Resolution priority for the HTTP MCP path**, in order of who
  wins:
  1. Tool-level `agent_id` arg on `claim_task` (highest).
  2. URL path: `/mcp/<adapterId>` (new).
  3. Detection on `/mcp` (clientInfo.name → User-Agent → last init seen).
  4. Static `TASKBRIDGE_AGENT_ID` env (default `generic`).
- **Prompt library templates reverted to identity-neutral.** The
  `solve-oldest` and `solve-this` templates no longer require a
  `WORKER_ID` variable. They tell the agent that taskbridge labels
  the task from the URL it connected to (`/mcp/codex` etc.) and
  passing `agent_id` to `claim_task` is now optional. Per-URL
  routing is the recommended default.
- **Behaviour change**: `tests/integration-mcp-stdio.test.js`'s
  "unknown agent id" test was rewritten for the new contract.
  Old: unknown id → tagged `generic`. New: unknown id → tagged
  with the raw id, generic instructions only. This is what makes
  custom adapters work at all.

### Fixed

- The 0.5.2 prompt-library templates required hardcoding the agent
  name into every prompt — clunky and not what the user asked for.
  Per-URL routing replaces that workaround entirely.

## [0.5.2] — 2026-04-13

### Fixed

- **Codex Desktop tasks were still tagged `generic`** even after the
  layered detection in 0.5.1 — server logs showed the `mcp client
  fallback` path firing repeatedly, meaning Codex's requests were
  reaching `/mcp` but matching neither `clientInfo.name` nor any of
  the User-Agent regex patterns. The 0.5.1 fallback log was too
  thin to tell us *what* Codex was sending.
- **Workaround that always works**: prompt-library templates now
  include a required `WORKER_ID` variable (default `"codex"`) and
  every template tells the agent to **always pass `agent_id` to
  `claim_task` explicitly**. The `agent_id` argument has always
  been a first-class override that beats every detection layer —
  so even if auto-detection misses, the badge will still be right.
- The per-task **Copy AI prompt** button and the **wand icon →
  prompt library** modal both default `WORKER_ID` to `"codex"` so
  copy-paste workflows just work without editing.

### Added

- **Per-request `/mcp` trace logging**. Every request to `POST/GET/
  DELETE /mcp` now emits a structured stderr line:
  ```
  {"msg":"mcp request","meta":{"httpMethod","bodyMethod",
                               "clientName","ua","ip","contentType"}}
  ```
  Pre-detection, pre-handler. So the next time a client mismatches
  detection, you can see the exact `bodyMethod` (initialize / tools/list
  / tools/call), the exact `clientName` (or null), and the exact
  `User-Agent` it sent. No more guessing.
- The existing `mcp client fallback` log line now includes `ua` and
  `ip` so the same diagnostic info is on the resolution path too.

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
