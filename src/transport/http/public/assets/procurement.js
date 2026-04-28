/* ============================================================
   Procurement PR list page — thin orchestrator.
   Loads PRs, renders cards, handles filters, pagination,
   and SSE for live updates.
   ============================================================ */

import { renderChrome, loadSettings, saveSettings, applyTheme, toast, relativeTime, absoluteTime } from "./chrome.js";
import { html, raw, toString } from "./html.js";

/* ---------- Constants ---------- */

const PR_STATUSES = [
  "all", "draft", "pending_approval", "approved", "rejected",
  "sourcing", "rfq_sent", "quotes_received", "po_issued",
  "delivered", "cancelled",
];

const STATUS_ICONS = {
  draft: "bi-pencil",
  pending_approval: "bi-hourglass-split",
  approved: "bi-check-circle",
  rejected: "bi-x-circle",
  pending_sourcing: "bi-search",
  sourcing: "bi-arrow-repeat",
  sourced: "bi-check2-all",
  rfq_pending: "bi-envelope",
  rfq_sending: "bi-send",
  rfq_sent: "bi-envelope-check",
  awaiting_replies: "bi-clock-history",
  quotes_received: "bi-receipt",
  analysis: "bi-graph-up",
  completed: "bi-trophy",
  po_issued: "bi-file-earmark-check",
  delivered: "bi-box-seam-fill",
  cancelled: "bi-slash-circle",
};

const PAGE_SIZES = [10, 25, 50];

/* ---------- State ---------- */

const state = {
  prs: [],
  loading: true,
  search: "",
  status: "all",
  page: 1,
  pageSize: 10,
};

/* ---------- API ---------- */

const api = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
};

const loadPrs = async () => {
  try {
    state.loading = true;
    render();
    const params = new URLSearchParams();
    if (state.status !== "all") params.set("status", state.status);
    if (state.search.trim()) params.set("search", state.search.trim());
    const body = await api(`/api/procurement/prs?${params}`);
    state.prs = body.prs || [];
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    render();
    toast("Failed to load purchase requests");
    console.error("[procurement]", err);
  }
};

/* ---------- Stats rendering ---------- */

const renderStats = () => {
  const el = document.getElementById("pr-stats");
  if (!el) return;

  const openStatuses = new Set(["pending_approval", "approved", "pending_sourcing"]);
  const sourcingStatuses = new Set(["sourcing", "sourced"]);
  const rfqStatuses = new Set(["rfq_pending", "rfq_sending", "rfq_sent", "awaiting_replies"]);
  const doneStatuses = new Set(["completed", "delivered", "po_issued"]);

  const open = state.prs.filter((p) => openStatuses.has(p.status)).length;
  const sourcing = state.prs.filter((p) => sourcingStatuses.has(p.status)).length;
  const rfq = state.prs.filter((p) => rfqStatuses.has(p.status)).length;
  const done = state.prs.filter((p) => doneStatuses.has(p.status)).length;

  el.innerHTML = toString(html`
    <div class="tb-stat-card">
      <div class="tb-stat-value">${open}</div>
      <div class="tb-stat-label">Open</div>
    </div>
    <div class="tb-stat-card">
      <div class="tb-stat-value">${sourcing}</div>
      <div class="tb-stat-label">Sourcing</div>
    </div>
    <div class="tb-stat-card">
      <div class="tb-stat-value">${rfq}</div>
      <div class="tb-stat-label">RFQ</div>
    </div>
    <div class="tb-stat-card">
      <div class="tb-stat-value">${done}</div>
      <div class="tb-stat-label">Completed</div>
    </div>
  `);
};

/* ---------- Derived ---------- */

const filtered = () => {
  const q = state.search.trim().toLowerCase();
  let list = [...state.prs];
  if (state.status !== "all") list = list.filter((p) => p.status === state.status);
  if (q) {
    list = list.filter((p) =>
      (p.title || "").toLowerCase().includes(q) ||
      (p.id || "").toLowerCase().includes(q) ||
      (p.requested_by || "").toLowerCase().includes(q)
    );
  }
  return list;
};

const paged = () => {
  const list = filtered();
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pageCount) state.page = pageCount;
  const start = (state.page - 1) * state.pageSize;
  const end = Math.min(start + state.pageSize, total);
  return { list, slice: list.slice(start, end), total, pageCount, start, end };
};

/* ---------- Render helpers ---------- */

const statusLabel = (s) => (s || "").replace(/_/g, " ");

const statusPill = (status) => html`
  <span class="tb-pill tb-pill-${status}">
    <i class="bi ${STATUS_ICONS[status] || "bi-circle"}"></i>${statusLabel(status)}
  </span>
`;

const relativeSpan = (ms) => {
  if (!ms) return html`<span class="text-body-secondary">--</span>`;
  return html`<span class="tb-relative-time" data-tb-rel="${ms}" title="${absoluteTime(ms)}">${relativeTime(ms)}</span>`;
};

const prCard = (pr) => {
  const itemCount = pr.items?.length || 0;
  const items = pr.items || [];
  const itemPreview = items.slice(0, 3).map((i) => `${i.material_name || "item"}${i.quantity ? ` (${i.quantity}${i.unit ? i.unit : ""})` : ""}`).join(" · ");
  const moreItems = items.length > 3 ? ` · +${items.length - 3} more` : "";
  const vendorCount = pr.shortlist?.length || 0;

  return html`
    <div class="tb-pr-card" data-pr-id="${pr.id}">
      <div class="tb-pr-card-header">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          ${statusPill(pr.status)}
          <a href="/procurement-detail.html?id=${pr.id}" class="tb-pr-card-title">${pr.title || "Untitled"}</a>
          <span class="text-body-secondary small tb-mono">#${(pr.id || "").slice(0, 6)}</span>
        </div>
        <div class="tb-pr-card-meta">
          ${pr.deadline ? html`<span><i class="bi bi-calendar-event me-1"></i>${pr.deadline}</span>` : ""}
          <span><i class="bi bi-box me-1"></i>${itemCount} item${itemCount !== 1 ? "s" : ""}</span>
          ${vendorCount > 0 ? html`<span><i class="bi bi-building me-1"></i>${vendorCount} vendor${vendorCount !== 1 ? "s" : ""}</span>` : ""}
          ${pr.requested_by ? html`<span><i class="bi bi-person me-1"></i>${pr.requested_by}</span>` : ""}
          ${relativeSpan(pr.created_at || pr.createdAt)}
        </div>
      </div>
      ${itemPreview ? html`
        <div class="tb-pr-card-items">
          <i class="bi bi-chevron-right me-1"></i>${itemPreview}${moreItems}
        </div>
      ` : ""}
      <div class="tb-pr-card-actions">
        <a href="/procurement-detail.html?id=${pr.id}" class="btn btn-outline-primary btn-sm">
          <i class="bi bi-eye me-1"></i>View
        </a>
        ${pr.status === "pending_approval" ? html`
          <button type="button" class="btn btn-success btn-sm" data-action="approve" data-id="${pr.id}">
            <i class="bi bi-check-lg me-1"></i>Approve
          </button>
          <button type="button" class="btn btn-danger btn-sm" data-action="reject" data-id="${pr.id}">
            <i class="bi bi-x-lg me-1"></i>Reject
          </button>
        ` : ""}
        ${pr.status !== "cancelled" && pr.status !== "delivered" && pr.status !== "rejected" && pr.status !== "completed" ? html`
          <button type="button" class="btn btn-outline-secondary btn-sm" data-action="cancel" data-id="${pr.id}">
            <i class="bi bi-slash-circle me-1"></i>Cancel
          </button>
        ` : ""}
      </div>
    </div>
  `;
};

/* ---------- Skeleton / empty ---------- */

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
    <div>No purchase requests match your filters.</div>
    <div class="small mt-1">Create one using the "New PR" button above.</div>
  </div>
`;

/* ---------- Full render ---------- */

const render = () => {
  renderStats();
  const listEl = document.getElementById("pr-list");
  const pagEl = document.getElementById("pr-pagination");
  if (!listEl) return;

  listEl.setAttribute("aria-busy", state.loading ? "true" : "false");

  if (state.loading && state.prs.length === 0) {
    listEl.innerHTML = toString(skeleton());
    if (pagEl) pagEl.innerHTML = "";
    return;
  }

  const view = paged();
  if (view.total === 0) {
    listEl.innerHTML = toString(emptyState());
    if (pagEl) pagEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = toString(html`
    <div class="tb-pr-list">${view.slice.map(prCard)}</div>
  `);

  if (pagEl) {
    pagEl.innerHTML = toString(html`
      <span>Showing ${view.start + 1}--${view.end} of ${view.total}</span>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? raw("disabled") : ""} data-action="page-prev">
          <i class="bi bi-chevron-left"></i> Prev
        </button>
        <span aria-live="polite">Page ${state.page} / ${view.pageCount}</span>
        <button class="btn btn-outline-secondary btn-sm" ${state.page >= view.pageCount ? raw("disabled") : ""} data-action="page-next">
          Next <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    `);
  }
};

/* ---------- Toolbar render ---------- */

const renderToolbar = () => {
  const el = document.getElementById("pr-toolbar");
  if (!el) return;
  el.innerHTML = toString(html`
    <div class="tb-search">
      <i class="bi bi-search" aria-hidden="true"></i>
      <label for="pr-q" class="visually-hidden">Search purchase requests</label>
      <input id="pr-q" type="search" class="form-control" placeholder="Search title, id, requester..." value="${state.search}">
    </div>
    <label for="pr-status" class="visually-hidden">Filter by status</label>
    <select id="pr-status" class="form-select" style="max-width:190px">
      ${PR_STATUSES.map((s) => html`<option value="${s}" ${s === state.status ? raw("selected") : ""}>${statusLabel(s) || "all"}</option>`)}
    </select>
    <label for="pr-pagesize" class="visually-hidden">Page size</label>
    <select id="pr-pagesize" class="form-select" style="max-width:110px" title="Page size">
      ${PAGE_SIZES.map((n) => html`<option value="${n}" ${n === state.pageSize ? raw("selected") : ""}>${n}/page</option>`)}
    </select>
    <button id="pr-refresh" class="tb-icon-btn" title="Reload from server" aria-label="Reload PRs">
      <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
    </button>
  `);
};

/* ---------- Action handlers ---------- */

const handleAction = async (action, id) => {
  try {
    switch (action) {
      case "approve":
        await api(`/api/procurement/prs/${id}/approve`, { method: "POST" });
        toast("PR approved");
        break;
      case "reject": {
        const reason = prompt("Reason for rejection:");
        if (reason === null) return;
        await api(`/api/procurement/prs/${id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        toast("PR rejected");
        break;
      }
      case "cancel":
        if (!confirm("Cancel this purchase request?")) return;
        await api(`/api/procurement/prs/${id}/cancel`, { method: "POST" });
        toast("PR cancelled");
        break;
      default:
        return;
    }
    await loadPrs();
  } catch (err) {
    toast(err.message || "Action failed");
    console.error("[procurement]", err);
  }
};

/* ---------- Event wiring ---------- */

const bindEvents = () => {
  // Toolbar
  const bind = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };
  bind("pr-q", "input", (e) => { state.search = e.target.value; state.page = 1; render(); });
  bind("pr-status", "change", (e) => { state.status = e.target.value; state.page = 1; render(); });
  bind("pr-pagesize", "change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; render(); });
  bind("pr-refresh", "click", () => loadPrs());

  // Delegated click on list + pagination
  for (const containerId of ["pr-list", "pr-pagination"]) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      const id = target.getAttribute("data-id");

      if (action === "page-prev") { state.page = Math.max(1, state.page - 1); render(); return; }
      if (action === "page-next") { state.page += 1; render(); return; }
      if (id) {
        e.preventDefault();
        handleAction(action, id);
      }
    });
  }
};

/* ---------- SSE ---------- */

const bindSse = () => {
  const es = new EventSource("/api/events");

  const prEvents = [
    "pr.created", "pr.updated", "pr.approved", "pr.rejected",
    "pr.submitted", "pr.cancelled", "pr.sourcing", "pr.rfq_sent",
    "pr.quotes_received", "pr.po_issued", "pr.delivered",
  ];

  for (const ev of prEvents) {
    es.addEventListener(ev, (e) => {
      try {
        const data = JSON.parse(e.data);
        const idx = state.prs.findIndex((p) => p.id === data.id);
        if (idx >= 0) state.prs[idx] = data;
        else state.prs.unshift(data);
        render();
      } catch { /* ignore */ }
    });
  }

  es.addEventListener("pr.deleted", (e) => {
    try {
      const data = JSON.parse(e.data);
      state.prs = state.prs.filter((p) => p.id !== data.id);
      render();
    } catch { /* ignore */ }
  });
};

/* ---------- Boot ---------- */

const boot = () => {
  const settings = loadSettings();
  applyTheme(settings.theme);
  renderChrome();
  renderToolbar();
  bindEvents();
  bindSse();
  render();
  loadPrs();

  // 30s ticker for relative times
  setInterval(() => {
    document.querySelectorAll(".tb-relative-time[data-tb-rel]").forEach((el) => {
      const ms = Number(el.getAttribute("data-tb-rel"));
      if (ms) el.textContent = relativeTime(ms);
    });
  }, 30000);
};

boot();
