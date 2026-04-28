/* ============================================================
   Procurement PR dashboard — list, filter, stats, actions.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast, relativeTime, absoluteTime } from "./chrome.js";
import { html, raw, toString } from "./html.js";
import { createListControls } from "./list-controls.js";

/* ---------- Procurement status groups (simplified phases) ---------- */

const PHASE = {
  draft:      { label: "Draft",      icon: "bi-pencil",              color: "secondary" },
  approval:   { label: "Approval",   icon: "bi-hourglass-split",     color: "warning" },
  pending:    { label: "Pending",    icon: "bi-clock",               color: "info" },
  processing: { label: "Processing", icon: "bi-arrow-repeat",        color: "primary" },
  done:       { label: "Completed",  icon: "bi-check-circle",        color: "success" },
};

const STATUS_TO_PHASE = {
  draft:              "draft",
  pending_approval:   "approval",
  pending:            "pending",
  processing:         "processing",
  failed:             "processing",
  completed:          "done",
  cancelled:          "done",
};

const STATUS_ICON = {
  draft: "bi-pencil",
  pending_approval: "bi-hourglass-split",
  pending: "bi-clock",
  processing: "bi-arrow-repeat",
  failed: "bi-exclamation-triangle",
  completed: "bi-check-circle",
  cancelled: "bi-slash-circle",
};

const phaseOf = (status) => STATUS_TO_PHASE[status] || "draft";
const statusLabel = (s) => (s || "").replace(/_/g, " ");

/* ---------- State ---------- */

const state = {
  prs: [],
  loading: true,
  activePhase: null,
  currentUser: null,
};

let controls = null;

/* ---------- API ---------- */

const api = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  return body;
};

const loadPrs = async () => {
  try {
    state.loading = true;
    render();
    const body = await api("/api/procurement/prs");
    state.prs = body.purchaseRequests || body.prs || [];
    state.loading = false;
    rebuildControls();
    render();
  } catch (err) {
    state.loading = false;
    render();
    toast("Failed to load purchase requests");
    console.error(err);
  }
};

/* ---------- Filtering ---------- */

const filtered = () => {
  const cs = controls ? controls.getState() : {};
  const q = (cs.search || "").trim().toLowerCase();
  const statusFilter = cs.filters?.status || "all";

  let list = [...state.prs];

  // Phase filter (from stat card click)
  if (state.activePhase) {
    list = list.filter((p) => phaseOf(p.status) === state.activePhase);
  }

  // Dropdown status filter
  if (statusFilter !== "all") {
    list = list.filter((p) => p.status === statusFilter);
  }

  // Search
  if (q) {
    list = list.filter((p) =>
      (p.title || "").toLowerCase().includes(q) ||
      (p.id || "").toLowerCase().includes(q) ||
      (p.requestedBy || "").toLowerCase().includes(q) ||
      (p.lineItems || []).some((i) => (i.materialName || "").toLowerCase().includes(q))
    );
  }

  // Sort
  const sort = cs.sort || "newest";
  list.sort((a, b) => {
    switch (sort) {
      case "newest":  return (b.createdAt || 0) - (a.createdAt || 0);
      case "oldest":  return (a.createdAt || 0) - (b.createdAt || 0);
      case "updated": return (b.updatedAt || 0) - (a.updatedAt || 0);
      case "status":  return (a.status || "").localeCompare(b.status || "");
      default: return 0;
    }
  });

  return list;
};

const paged = () => {
  const cs = controls ? controls.getState() : { page: 1, pageSize: 10 };
  const list = filtered();
  const total = list.length;
  const pageSize = cs.pageSize || 10;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  let page = cs.page || 1;
  if (page > pageCount) page = pageCount;
  const start = (page - 1) * pageSize;
  return { slice: list.slice(start, start + pageSize), total, pageCount, start };
};

/* ---------- Stats (clickable phase cards) ---------- */

const phaseCounts = () => {
  const counts = { draft: 0, approval: 0, pending: 0, processing: 0, done: 0 };
  for (const pr of state.prs) {
    const phase = phaseOf(pr.status);
    if (phase in counts) counts[phase]++;
  }
  return counts;
};

const renderStats = () => {
  const el = document.getElementById("pr-stats");
  if (!el) return;
  const counts = phaseCounts();
  const visible = ["draft", "approval", "pending", "processing", "done"];

  el.innerHTML = toString(html`
    ${visible.map((key) => html`
      <div class="tb-stat-card ${state.activePhase === key ? "active" : ""}" data-phase="${key}" role="button" tabindex="0" aria-label="Filter by ${PHASE[key].label}">
        <div class="tb-stat-value">${counts[key]}</div>
        <div class="tb-stat-label">${PHASE[key].label}</div>
      </div>
    `)}
  `);

  el.addEventListener("click", (e) => {
    const card = e.target.closest("[data-phase]");
    if (!card) return;
    const phase = card.getAttribute("data-phase");
    state.activePhase = state.activePhase === phase ? null : phase;
    if (controls) controls.setState({ page: 1 });
    render();
  });
};

/* ---------- List controls ---------- */

const ALL_STATUSES = [
  "all", "draft", "pending_approval", "pending",
  "processing", "failed", "completed", "cancelled",
];

const rebuildControls = () => {
  controls.render({
    views: ["list"],
    sorts: [
      { value: "newest", label: "Newest first" },
      { value: "oldest", label: "Oldest first" },
      { value: "updated", label: "Recently updated" },
      { value: "status", label: "By status" },
    ],
    defaultSort: "newest",
    filters: [{
      id: "status",
      label: "Status",
      options: ALL_STATUSES.map((s) => ({ value: s, label: s === "all" ? "All statuses" : statusLabel(s) })),
    }],
    pageSize: 10,
    pageSizes: [10, 25, 50],
    totalItems: filtered().length,
    searchPlaceholder: "Search title, id, requester, material...",
  });
};

/* ---------- Item-level helpers ---------- */

const ITEM_STATUS_LABELS = {
  draft: "draft", sourcing: "sourcing", quoted: "quoted",
  selected: "selected", ordered: "ordered", received: "received",
  cancelled: "cancelled",
};

const itemCounts = (items) => {
  const counts = { done: 0, active: 0, waiting: 0 };
  for (const i of items) {
    if (["selected", "ordered", "received"].includes(i.status)) counts.done++;
    else if (["sourcing", "quoted"].includes(i.status)) counts.active++;
    else counts.waiting++;
  }
  return counts;
};

const itemProgress = (items) => {
  if (!items || items.length === 0) return "";
  const total = items.length;
  const counts = itemCounts(items);
  const donePct = (counts.done / total * 100).toFixed(0);
  const activePct = (counts.active / total * 100).toFixed(0);
  return html`
    <div class="tb-item-progress" title="${counts.done} done, ${counts.active} active, ${counts.waiting} waiting">
      ${counts.done > 0 ? html`<div class="tb-item-progress-done" style="width:${donePct}%"></div>` : ""}
      ${counts.active > 0 ? html`<div class="tb-item-progress-active" style="width:${activePct}%"></div>` : ""}
    </div>
  `;
};

const itemStatusSummary = (items) => {
  if (!items || items.length === 0) return "";
  const byStatus = {};
  for (const i of items) {
    const s = i.status || "draft";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  // Show statuses in lifecycle order, skip zero counts
  const order = ["received", "ordered", "selected", "quoted", "sourcing", "draft", "cancelled"];
  const parts = order
    .filter((s) => byStatus[s] > 0)
    .map((s) => `${byStatus[s]} ${ITEM_STATUS_LABELS[s]}`);
  if (parts.length === 0) return "";
  return html`<div class="tb-item-summary">${parts.join(" \u00b7 ")}</div>`;
};

/* ---------- PR card ---------- */

const statusPill = (status) => html`
  <span class="tb-pill tb-pill-${status}">
    <i class="bi ${STATUS_ICON[status] || "bi-circle"}"></i>${statusLabel(status)}
  </span>
`;

const prCard = (pr) => {
  const items = pr.lineItems || [];
  const preview = items.slice(0, 3).map((i) =>
    `${i.materialName || "item"}${i.quantity ? ` (${i.quantity} ${i.unit || ""})` : ""}`
  ).join(" · ");
  const more = items.length > 3 ? ` +${items.length - 3} more` : "";

  return html`
    <div class="tb-pr-card" data-pr-id="${pr.id}" data-action="navigate" data-href="/procurement-detail.html?id=${pr.id}" role="link" tabindex="0">
      <div class="tb-pr-card-header">
        ${statusPill(pr.status)}
        <span class="tb-pr-card-title">${pr.title || "Untitled"}</span>
        <span class="text-body-secondary small tb-mono">#${(pr.id || "").slice(0, 8)}</span>
      </div>
      <div class="tb-pr-card-meta">
        <span><i class="bi bi-box me-1"></i>${items.length} item${items.length !== 1 ? "s" : ""}</span>
        ${pr.requestedBy ? html`<span><i class="bi bi-person me-1"></i>${pr.requestedBy}</span>` : ""}
        <span title="${absoluteTime(pr.createdAt)}">${relativeTime(pr.createdAt)}</span>
      </div>
      ${itemStatusSummary(items)}
      ${preview ? html`<div class="tb-pr-card-items"><i class="bi bi-chevron-right me-1"></i>${preview}${more}</div>` : ""}
      ${itemProgress(items)}
      ${pr.status === "pending_approval" ? html`
        <div class="tb-pr-card-actions">
          <button type="button" class="btn btn-success btn-sm" data-action="approve" data-id="${pr.id}">
            <i class="bi bi-check-lg me-1"></i>Approve
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm" data-action="reject" data-id="${pr.id}">
            <i class="bi bi-x-lg me-1"></i>Reject
          </button>
        </div>
      ` : ""}
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
    <div class="small mt-1">Create one using the "New Purchase Request" button, or click a stat card to clear the filter.</div>
  </div>
`;

/* ---------- Render ---------- */

const render = () => {
  renderStats();
  const listEl = document.getElementById("pr-list");
  if (!listEl) return;

  listEl.setAttribute("aria-busy", state.loading ? "true" : "false");

  if (state.loading && state.prs.length === 0) {
    listEl.innerHTML = toString(skeleton());
    return;
  }

  const view = paged();
  if (controls) controls.setState({ totalItems: view.total });

  if (view.total === 0) {
    listEl.innerHTML = toString(emptyState());
    return;
  }

  listEl.innerHTML = toString(html`<div class="tb-list">${view.slice.map(prCard)}</div>`);
};

/* ---------- Actions ---------- */

const handleAction = async (action, id) => {
  try {
    if (action === "approve") {
      const approvedBy = state.currentUser?.username || "admin";
      await api(`/api/procurement/prs/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy }) });
      toast("PR approved");
    } else if (action === "reject") {
      const reason = prompt("Reason for rejection:");
      if (reason === null) return;
      await api(`/api/procurement/prs/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      toast("PR rejected");
    } else if (action === "cancel") {
      if (!confirm("Cancel this purchase request?")) return;
      await api(`/api/procurement/prs/${id}/cancel`, { method: "POST" });
      toast("PR cancelled");
    } else return;
    await loadPrs();
  } catch (err) {
    toast(err.message || "Action failed");
  }
};

/* ---------- Events ---------- */

const bindEvents = () => {
  document.getElementById("pr-list")?.addEventListener("click", (e) => {
    // Action buttons (approve, reject, cancel) take priority
    const btn = e.target.closest("button[data-action]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      handleAction(btn.getAttribute("data-action"), btn.getAttribute("data-id"));
      return;
    }
    // Card click → navigate to detail
    const card = e.target.closest("[data-action='navigate']");
    if (card) {
      window.location.href = card.getAttribute("data-href");
    }
  });
};

const bindSse = () => {
  const es = new EventSource("/api/events");
  const events = [
    "pr.created", "pr.updated", "pr.approved", "pr.rejected",
    "pr.submitted", "pr.cancelled", "pr.completed",
    "pr.processing", "pr.review", "pr.failed",
    "item.status_changed",
  ];
  for (const ev of events) {
    es.addEventListener(ev, (e) => {
      try {
        const data = JSON.parse(e.data);
        const idx = state.prs.findIndex((p) => p.id === data.id);
        if (idx >= 0) state.prs[idx] = { ...state.prs[idx], ...data };
        else state.prs.unshift(data);
        render();
      } catch {}
    });
  }
};

/* ---------- Inline new PR form ---------- */

let itemCounter = 0;

const addItemRow = () => {
  const container = document.getElementById("pr-items-container");
  if (!container) return;
  const idx = itemCounter++;
  const row = document.createElement("div");
  row.className = "d-flex gap-2 mb-2 align-items-end";
  row.setAttribute("data-item-row", idx);
  row.innerHTML = `
    <input type="text" class="form-control form-control-sm" placeholder="Material name" data-field="materialName" required style="flex:2" />
    <input type="text" class="form-control form-control-sm" placeholder="Spec" data-field="specification" style="flex:1" />
    <input type="number" class="form-control form-control-sm" placeholder="Qty" data-field="quantity" required style="width:80px" />
    <input type="text" class="form-control form-control-sm" placeholder="Unit" data-field="unit" required style="width:80px" />
    <button type="button" class="btn btn-outline-danger btn-sm" data-remove-item="${idx}" title="Remove" style="min-width:36px"><i class="bi bi-x"></i></button>
  `;
  container.appendChild(row);
};

const getFormItems = () => {
  const rows = document.querySelectorAll("#pr-items-container [data-item-row]");
  const items = [];
  for (const row of rows) {
    const materialName = row.querySelector("[data-field='materialName']")?.value?.trim();
    const specification = row.querySelector("[data-field='specification']")?.value?.trim() || null;
    const quantity = Number(row.querySelector("[data-field='quantity']")?.value) || 0;
    const unit = row.querySelector("[data-field='unit']")?.value?.trim();
    if (materialName && quantity > 0 && unit) {
      items.push({ materialName, specification, quantity, unit });
    }
  }
  return items;
};

const resetForm = () => {
  const form = document.getElementById("pr-form");
  if (form) form.reset();
  const container = document.getElementById("pr-items-container");
  if (container) container.innerHTML = "";
  itemCounter = 0;
  addItemRow();
};

const submitPr = async (asDraft) => {
  const title = document.getElementById("pr-title")?.value?.trim();
  if (!title) { toast("Title is required"); return; }
  const lineItems = getFormItems();
  if (lineItems.length === 0) { toast("Add at least one item"); return; }

  const body = {
    title,
    requestedBy: state.currentUser?.username || "admin",
    deadline: document.getElementById("pr-deadline")?.value ? new Date(document.getElementById("pr-deadline").value).getTime() : null,
    notes: document.getElementById("pr-notes")?.value?.trim() || null,
    lineItems,
  };

  try {
    const pr = await api("/api/procurement/prs", { method: "POST", body: JSON.stringify(body) });
    if (!asDraft) {
      await api(`/api/procurement/prs/${pr.id}/submit`, { method: "POST" });
      toast("PR submitted for approval");
    } else {
      toast("PR saved as draft");
    }
    resetForm();
    document.getElementById("pr-new-form").style.display = "none";
    await loadPrs();
  } catch (err) {
    toast(err.message || "Failed to create PR");
  }
};

const bindInlineForm = () => {
  const toggleBtn = document.getElementById("btn-toggle-new-pr");
  const closeBtn = document.getElementById("btn-close-new-pr");
  const formSection = document.getElementById("pr-new-form");
  const addItemBtn = document.getElementById("btn-add-item");
  const saveDraftBtn = document.getElementById("btn-save-draft");
  const form = document.getElementById("pr-form");
  const itemsContainer = document.getElementById("pr-items-container");

  if (toggleBtn && formSection) {
    toggleBtn.addEventListener("click", () => {
      const visible = formSection.style.display !== "none";
      formSection.style.display = visible ? "none" : "block";
      if (!visible && itemsContainer && itemsContainer.children.length === 0) addItemRow();
    });
  }
  if (closeBtn && formSection) {
    closeBtn.addEventListener("click", () => { formSection.style.display = "none"; });
  }
  if (addItemBtn) addItemBtn.addEventListener("click", addItemRow);
  if (itemsContainer) {
    itemsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-item]");
      if (btn) btn.closest("[data-item-row]")?.remove();
    });
  }
  if (saveDraftBtn) saveDraftBtn.addEventListener("click", () => submitPr(true));
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); submitPr(false); });
};

/* ---------- Boot ---------- */

const boot = () => {
  applyTheme(loadSettings().theme);
  renderChrome();

  controls = createListControls({
    storageKey: "procurement",
    toolbarContainer: document.getElementById("pr-toolbar"),
    paginationContainer: document.getElementById("pr-pagination"),
    onUpdate: () => render(),
  });

  bindEvents();
  bindSse();
  bindInlineForm();
  render();
  loadPrs();

  fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(u => { state.currentUser = u; }).catch(() => {});

  setInterval(() => {
    document.querySelectorAll(".tb-relative-time[data-tb-rel]").forEach((el) => {
      const ms = Number(el.getAttribute("data-tb-rel"));
      if (ms) el.textContent = relativeTime(ms);
    });
  }, 30_000);
};

boot();
