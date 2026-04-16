/* ============================================================
   Pure render functions for the tasks dashboard.
   ============================================================ */

import { relativeTime, absoluteTime, renderMarkdown } from "./chrome.js";
import { html, raw, toString } from "./html.js";
import { PAGE_SIZES, SORTS, STATUSES } from "./task-state.js";

/* ---------- Formatters ---------- */

export const formatDuration = (ms) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s}s`;
};

export const formatNumber = (n) => (n == null ? "—" : new Intl.NumberFormat().format(n));

const shortId = (id) => String(id).slice(0, 8);

const STATUS_ICON = {
  pending: "bi-hourglass-split",
  in_progress: "bi-arrow-repeat",
  done: "bi-check-circle-fill",
  failed: "bi-x-octagon-fill",
};

/* ---------- Small building blocks ---------- */

const statusPill = (status) => html`
  <span class="tb-pill tb-pill-${status}">
    <i class="bi ${STATUS_ICON[status] || "bi-circle"}"></i>${status.replace("_", " ")}${status === "in_progress" ? raw(`<span class="tb-working-dots" aria-hidden="true"><span></span><span></span><span></span></span>`) : ""}
  </span>
`;

const archivedPill = (isArchived) =>
  isArchived ? html`<span class="tb-pill tb-pill-archived"><i class="bi bi-archive"></i>archived</span>` : "";

const agentBadge = (agentId) =>
  agentId ? html`<span class="tb-agent-badge"><i class="bi bi-robot"></i>${agentId}</span>` : "";

/** Live elapsed pill — `.tb-elapsed-text` is mutated by the 1 Hz ticker. */
const livePill = (claimedAt) => {
  if (!claimedAt) return "";
  return html`
    <span class="tb-elapsed-live" data-since="${claimedAt}" title="Live elapsed since claim">
      <i class="bi bi-stopwatch"></i>
      <span class="tb-elapsed-text">${formatDuration(Date.now() - claimedAt)}</span>
    </span>
  `;
};

/** Relative timestamp — textContent is mutated by the 30 s ticker. */
const relativeSpan = (ms, className = "tb-meta-time") => {
  if (!ms) return html`<span class="${className}">—</span>`;
  return html`
    <span class="${className} tb-relative-time" data-tb-rel="${ms}" title="${absoluteTime(ms)}">
      ${relativeTime(ms)}
    </span>
  `;
};

/* ---------- Content blocks (prompt / result / error / progress) ---------- */

const contentBlock = (label, text, mode, { isError = false } = {}) => {
  if (!text) return "";
  const body = mode === "raw"
    ? html`<div class="tb-codeblock ${isError ? "tb-codeblock-error" : ""}">${text}</div>`
    : html`<div class="tb-prose ${isError ? "tb-prose-error" : ""}">${raw(renderMarkdown(text))}</div>`;
  return html`
    <div class="tb-section-label mt-3">${label}</div>
    ${body}
  `;
};

const runDetails = (t) => {
  const wait = t.claimedAt && t.createdAt ? t.claimedAt - t.createdAt : null;
  const work = t.completedAt && t.claimedAt ? t.completedAt - t.claimedAt : null;
  const total = t.completedAt && t.createdAt ? t.completedAt - t.createdAt : null;
  const isTerminal = t.status === "done" || t.status === "failed";
  const anyMetadata = t.model != null || t.tokensIn != null || t.tokensOut != null
                   || t.totalTokens != null || work != null || wait != null || total != null;
  if (!isTerminal && !anyMetadata) return "";

  const dash = raw(`<span class="text-body-secondary">—</span>`);
  const cell = (label, value, mono = false) => html`
    <div><dt>${label}</dt><dd class="${mono ? "tb-mono" : ""}">${value}</dd></div>
  `;
  const noMetadata = t.model == null && t.totalTokens == null
                  && t.tokensIn == null && t.tokensOut == null
                  && isTerminal;

  return html`
    <div class="tb-section-label mt-3">Run details</div>
    <dl class="tb-timestamps tb-run-details">
      ${cell("Model", t.model || dash, true)}
      ${cell("Time working", work != null ? formatDuration(work) : dash)}
      ${cell("Time waiting", wait != null ? formatDuration(wait) : dash)}
      ${cell("Total elapsed", total != null ? formatDuration(total) : dash)}
      ${cell("Tokens in", t.tokensIn != null ? formatNumber(t.tokensIn) : dash)}
      ${cell("Tokens out", t.tokensOut != null ? formatNumber(t.tokensOut) : dash)}
      ${cell("Total tokens", t.totalTokens != null ? formatNumber(t.totalTokens) : dash)}
    </dl>
    ${noMetadata ? raw(`<div class="small text-body-secondary mt-1"><i class="bi bi-info-circle me-1"></i>Model and token usage are populated when your MCP client passes <code>model</code> / <code>tokens_in</code> / <code>tokens_out</code> on <code>submit_result</code>.</div>`) : ""}
  `;
};

/* ---------- Action button rows (delegated — data-action + data-id) ---------- */

const promptActions = (id) => html`
  <div class="btn-group btn-group-sm" role="group" aria-label="AI prompt actions">
    <button type="button" class="btn btn-outline-primary" data-action="copy-prompt" data-id="${id}" title="Copy a ready-to-use prompt that tells an AI agent to claim and solve this task">
      <i class="bi bi-clipboard me-1"></i>Copy AI prompt
    </button>
    <button type="button" class="btn btn-outline-primary" data-action="open-prompts" data-id="${id}" title="Open the full prompt library">
      <i class="bi bi-magic" aria-hidden="true"></i>
      <span class="visually-hidden">Open prompt library</span>
    </button>
  </div>
`;

const taskActions = (t) => {
  const id = t.id;
  const canEdit = t.status === "pending" && !t.archivedAt;
  return html`
    <div class="btn-group btn-group-sm" role="group" aria-label="Task actions">
      ${canEdit ? html`
        <button type="button" class="btn btn-outline-secondary" data-action="edit" data-id="${id}" title="Edit prompt (only available while pending)">
          <i class="bi bi-pencil" aria-hidden="true"></i>
          <span class="visually-hidden">Edit</span>
        </button>
      ` : ""}
      ${t.archivedAt
        ? html`
          <button type="button" class="btn btn-outline-secondary" data-action="unarchive" data-id="${id}" title="Unarchive">
            <i class="bi bi-archive-fill" aria-hidden="true"></i>
            <span class="visually-hidden">Unarchive</span>
          </button>`
        : html`
          <button type="button" class="btn btn-outline-secondary" data-action="archive" data-id="${id}" title="Archive — hides from default list, reversible">
            <i class="bi bi-archive" aria-hidden="true"></i>
            <span class="visually-hidden">Archive</span>
          </button>`}
      <button type="button" class="btn btn-outline-danger" data-action="delete" data-id="${id}" title="Delete permanently">
        <i class="bi bi-trash" aria-hidden="true"></i>
        <span class="visually-hidden">Delete</span>
      </button>
    </div>
  `;
};

const viewModeToggle = (id, mode) => html`
  <div class="tb-seg" role="tablist" aria-label="View mode">
    <button type="button" class="tb-seg-btn ${mode === "rendered" ? "active" : ""}" role="tab" aria-selected="${mode === "rendered"}" data-action="set-mode" data-mode="rendered" data-id="${id}">
      <i class="bi bi-eye" aria-hidden="true"></i>Rendered
    </button>
    <button type="button" class="tb-seg-btn ${mode === "raw" ? "active" : ""}" role="tab" aria-selected="${mode === "raw"}" data-action="set-mode" data-mode="raw" data-id="${id}">
      <i class="bi bi-code-slash" aria-hidden="true"></i>Raw
    </button>
  </div>
`;

const promptEditor = (t, draft) => html`
  <div class="tb-section-label mt-3">Prompt (editing)</div>
  <textarea class="form-control tb-edit-textarea" data-action="edit-input" data-id="${t.id}" rows="4" aria-label="Edit task prompt">${draft ?? t.prompt}</textarea>
  <div class="d-flex gap-2 mt-2">
    <button type="button" class="btn btn-primary btn-sm" data-action="save-edit" data-id="${t.id}">
      <i class="bi bi-check2 me-1"></i>Save
    </button>
    <button type="button" class="btn btn-outline-secondary btn-sm" data-action="cancel-edit" data-id="${t.id}">
      Cancel
    </button>
  </div>
`;

/* ---------- Task accordion item ---------- */

const taskItem = (t, store) => {
  const expanded = store.state.expanded.has(t.id);
  const mode = store.modeFor(t.id);
  const isArchived = t.archivedAt != null;
  const isEditing = store.state.editing.has(t.id);
  const isRunning = t.status === "in_progress";
  const collapseId = `tb-acc-${t.id}`;

  const animClasses = [
    isRunning ? "tb-task-running" : "",
    store.state.justCreated.has(t.id) ? "tb-task-just-created" : "",
    store.state.justDone.has(t.id) ? "tb-task-just-done" : "",
    store.state.justFailed.has(t.id) ? "tb-task-just-failed" : "",
  ].filter(Boolean).join(" ");

  return html`
    <div class="accordion-item ${isArchived ? "tb-task-archived" : ""} ${animClasses}" data-id="${t.id}">
      <h2 class="accordion-header">
        <button class="accordion-button ${expanded ? "" : "collapsed"}" type="button"
                data-bs-toggle="collapse" data-bs-target="#${collapseId}"
                aria-expanded="${expanded}" aria-controls="${collapseId}">
          <div class="tb-task-row">
            ${statusPill(t.status)}
            ${archivedPill(isArchived)}
            <span class="tb-task-id">#${shortId(t.id)}</span>
            <span class="tb-task-prompt">${t.prompt}</span>
            <span class="tb-task-meta">
              ${isRunning ? livePill(t.claimedAt) : ""}
              ${agentBadge(t.agentId)}
              ${relativeSpan(t.updatedAt || t.createdAt)}
            </span>
          </div>
        </button>
      </h2>
      <div id="${collapseId}" class="accordion-collapse collapse ${expanded ? "show" : ""}">
        <div class="accordion-body">
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div class="d-flex gap-2 flex-wrap">
              ${promptActions(t.id)}
              ${taskActions(t)}
            </div>
            ${viewModeToggle(t.id, mode)}
          </div>

          ${isEditing ? promptEditor(t, store.state.drafts.get(t.id)) : contentBlock("Prompt", t.prompt, mode)}
          ${contentBlock("Latest progress", t.progress, mode)}
          ${contentBlock("Result", t.result, mode)}
          ${contentBlock("Error", t.error, mode, { isError: true })}

          ${runDetails(t)}

          <dl class="tb-timestamps">
            <div><dt>Created</dt><dd>${relativeSpan(t.createdAt, "")}</dd></div>
            <div><dt>Updated</dt><dd>${relativeSpan(t.updatedAt, "")}</dd></div>
            <div><dt>Claimed</dt><dd>${relativeSpan(t.claimedAt, "")}</dd></div>
            <div><dt>Completed</dt><dd>${relativeSpan(t.completedAt, "")}</dd></div>
            ${isArchived ? html`<div><dt>Archived</dt><dd>${relativeSpan(t.archivedAt, "")}</dd></div>` : ""}
            <div><dt>Full id</dt><dd class="tb-mono">${t.id}</dd></div>
            <div><dt>Agent</dt><dd>${t.agentId || "—"}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  `;
};

/* ---------- List-level markup (empty / loading / list) ---------- */

const skeleton = () => html`
  <div class="tb-skeleton-list" aria-hidden="true">
    ${[0, 1, 2].map(() => html`
      <div class="tb-skeleton-card">
        <div class="tb-skeleton-line tb-skeleton-line-sm"></div>
        <div class="tb-skeleton-line tb-skeleton-line-lg"></div>
        <div class="tb-skeleton-line tb-skeleton-line-md"></div>
      </div>
    `)}
  </div>
`;

const emptyState = () => html`
  <div class="tb-empty" role="status">
    <i class="bi bi-inbox" aria-hidden="true"></i>
    <div>No tasks match your filters.</div>
    <div class="small mt-1">Submit one above, or adjust the search/status.</div>
  </div>
`;

export const renderList = (store, view) => {
  const container = document.getElementById("tb-list");
  if (!container) return;

  container.setAttribute("aria-busy", store.state.loading ? "true" : "false");

  if (store.state.loading && store.size === 0) {
    container.innerHTML = toString(skeleton());
    return;
  }

  const { slice, total } = view || store.paged();
  if (total === 0) {
    container.innerHTML = toString(emptyState());
    return;
  }

  const items = slice.map((t) => taskItem(t, store));
  container.innerHTML = toString(html`<div class="accordion tb-tasks">${items}</div>`);
};

export const renderPagination = (store, view) => {
  const pag = document.getElementById("tb-pagination");
  if (!pag) return;
  const { total, pageCount, start, end } = view || store.paged();
  pag.innerHTML = toString(html`
    <span>Showing ${total === 0 ? 0 : start + 1}–${end} of ${total}</span>
    <div class="d-flex align-items-center gap-2">
      <button class="btn btn-outline-secondary" ${store.state.page <= 1 ? raw("disabled") : ""} data-action="page-prev">
        <i class="bi bi-chevron-left" aria-hidden="true"></i> Prev
      </button>
      <span aria-live="polite">Page ${store.state.page} / ${pageCount}</span>
      <button class="btn btn-outline-secondary" ${store.state.page >= pageCount ? raw("disabled") : ""} data-action="page-next">
        Next <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `);
};

export const renderToolbar = (store) => {
  const el = document.getElementById("tb-toolbar");
  if (!el) return;
  el.innerHTML = toString(html`
    <div class="tb-search">
      <i class="bi bi-search" aria-hidden="true"></i>
      <label for="tb-q" class="visually-hidden">Search tasks</label>
      <input id="tb-q" type="search" class="form-control" placeholder="Search id, prompt, agent, result…" value="${store.state.search}">
    </div>
    <label for="tb-status" class="visually-hidden">Filter by status</label>
    <select id="tb-status" class="form-select" style="max-width:160px">
      ${STATUSES.map((s) => html`<option value="${s}" ${s === store.state.status ? raw("selected") : ""}>${s.replace("_", " ")}</option>`)}
    </select>
    <label for="tb-sort" class="visually-hidden">Sort order</label>
    <select id="tb-sort" class="form-select" style="max-width:190px">
      ${Object.entries(SORTS).map(([k, v]) => html`<option value="${k}" ${k === store.state.sort ? raw("selected") : ""}>${v.label}</option>`)}
    </select>
    <label for="tb-pagesize" class="visually-hidden">Page size</label>
    <select id="tb-pagesize" class="form-select" style="max-width:110px" title="Page size">
      ${PAGE_SIZES.map((n) => html`<option value="${n}" ${n === store.state.pageSize ? raw("selected") : ""}>${n}/page</option>`)}
    </select>
    <div class="form-check form-switch m-0 ms-1" title="Show archived tasks">
      <input class="form-check-input" type="checkbox" id="tb-show-archived" ${store.state.showArchived ? raw("checked") : ""}>
      <label class="form-check-label small text-body-secondary" for="tb-show-archived">Archived</label>
    </div>
    <button id="tb-refresh" class="tb-icon-btn" title="Reload from server" aria-label="Reload tasks">
      <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
    </button>
  `);
};
