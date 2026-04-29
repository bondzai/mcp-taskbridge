/* ============================================================
   Procurement PR detail page.
   Fetches a single PR by id, renders all sections (header,
   timeline, items, shortlist, RFQ, comparison), handles actions.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast, relativeTime, absoluteTime } from "./chrome.js";
import { html, raw, toString } from "./html.js";

/* ---------- Constants ---------- */

const STATUS_ICONS = {
  draft: "bi-pencil",
  pending_approval: "bi-hourglass-split",
  pending: "bi-clock",
  processing: "bi-arrow-repeat",
  failed: "bi-exclamation-triangle",
  completed: "bi-check-circle",
  cancelled: "bi-slash-circle",
};

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

/* Item status lifecycle */
const ITEM_STATUS_LABELS = {
  draft: "Draft", sourcing: "Sourcing", quoted: "Quoted",
  selected: "Selected", ordered: "Ordered", received: "Received",
  cancelled: "Cancelled",
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

/* ---------- State ---------- */

let pr = null;
let timeline = [];
let comparison = null;

const prId = () => new URLSearchParams(location.search).get("id");

/* ---------- Load data ---------- */

const loadPr = async () => {
  const id = prId();
  if (!id) {
    showError("No PR id specified in URL.");
    return;
  }
  try {
    pr = await api(`/api/procurement/prs/${id}`);
    document.title = `Procurement Agent — PR: ${pr.title || id.slice(0, 8)}`;
    document.getElementById("pr-subtitle").textContent = pr.title || "Untitled";

    // Load timeline
    try {
      const tl = await api(`/api/procurement/prs/${id}/timeline`);
      timeline = tl.entries || tl.timeline || [];
    } catch { timeline = []; }

    // Load comparison if applicable
    const compStatuses = new Set(["processing", "completed"]);
    if (compStatuses.has(pr.status)) {
      try {
        comparison = await api(`/api/procurement/prs/${id}/comparison`);
      } catch { comparison = null; }
    }

    showContent();
    renderAll();
  } catch (err) {
    showError(err.message || "Failed to load purchase request.");
    console.error("[pr-detail]", err);
  }
};

/* ---------- UI state toggles ---------- */

const showError = (msg) => {
  document.getElementById("pr-loading").classList.add("d-none");
  document.getElementById("pr-content").classList.add("d-none");
  const errEl = document.getElementById("pr-error");
  errEl.classList.remove("d-none");
  document.getElementById("pr-error-msg").textContent = msg;
};

const showContent = () => {
  document.getElementById("pr-loading").classList.add("d-none");
  document.getElementById("pr-error").classList.add("d-none");
  document.getElementById("pr-content").classList.remove("d-none");
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
  return html`
    <span class="tb-relative-time" data-tb-rel="${ms}" title="${absoluteTime(ms)}">
      ${relativeTime(ms)}
    </span>
  `;
};

/* ---------- Render: header ---------- */

const renderHeader = () => {
  const el = document.getElementById("pr-header-card");
  if (!el || !pr) return;
  el.innerHTML = toString(html`
    <div class="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
      <div>
        <h2 class="h5 mb-1">${pr.title || "Untitled"}</h2>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          ${statusPill(pr.status)}
          <span class="text-body-secondary small">#${(pr.id || "").slice(0, 8)}</span>
        </div>
      </div>
      ${pr.deadline ? html`
        <div class="text-end">
          <div class="small text-body-secondary">Deadline</div>
          <div class="fw-semibold"><i class="bi bi-calendar-event me-1"></i>${pr.deadline}</div>
        </div>
      ` : ""}
    </div>
    <dl class="tb-timestamps">
      <div><dt>Requested by</dt><dd>${pr.requested_by || "--"}</dd></div>
      <div><dt>Created</dt><dd>${relativeSpan(pr.created_at || pr.createdAt)}</dd></div>
      <div><dt>Updated</dt><dd>${relativeSpan(pr.updated_at || pr.updatedAt)}</dd></div>
      <div><dt>Full ID</dt><dd class="tb-mono">${pr.id || "--"}</dd></div>
    </dl>
    ${pr.notes ? html`
      <div class="tb-section-label mt-3">Notes</div>
      <div class="small">${pr.notes}</div>
    ` : ""}
  `);
};

/* ---------- Render: actions ---------- */

const renderActions = () => {
  const el = document.getElementById("pr-actions");
  if (!el || !pr) return;

  const btns = [];

  if (pr.status === "pending_approval") {
    btns.push(html`
      <button type="button" class="btn btn-success" data-action="approve">
        <i class="bi bi-check-lg me-1"></i>Approve
      </button>
      <button type="button" class="btn btn-outline-danger" data-action="reject">
        <i class="bi bi-x-lg me-1"></i>Reject
      </button>
    `);
  }

  // Duplicate — available on any PR
  btns.push(html`
    <button type="button" class="btn btn-outline-secondary" data-action="duplicate">
      <i class="bi bi-copy me-1"></i>Duplicate
    </button>
  `);

  // Reprocess — available on processing/completed/failed (not draft/pending_approval)
  if (["processing", "pending", "completed", "failed"].includes(pr.status)) {
    btns.push(html`
      <button type="button" class="btn btn-outline-primary" data-action="reprocess">
        <i class="bi bi-arrow-counterclockwise me-1"></i>Reprocess
      </button>
    `);
  }

  if (!TERMINAL_STATUSES.has(pr.status)) {
    btns.push(html`
      <button type="button" class="btn btn-outline-danger" data-action="cancel">
        <i class="bi bi-slash-circle me-1"></i>Cancel
      </button>
    `);
  }

  el.innerHTML = toString(html`${btns}`);
};

/* ---------- Render: timeline ---------- */

const renderTimeline = () => {
  const el = document.getElementById("pr-timeline");
  if (!el) return;

  if (timeline.length === 0) {
    el.innerHTML = toString(html`<div class="small text-body-secondary">No status history available.</div>`);
    return;
  }

  el.innerHTML = toString(html`
    <div class="tb-timeline">
      ${timeline.map((entry, i) => html`
        <div class="tb-timeline-item ${i === 0 ? "tb-timeline-item-latest" : ""}">
          <div class="tb-timeline-dot"></div>
          <div class="tb-timeline-content">
            <div class="d-flex align-items-center gap-2">
              <span class="tb-pill tb-pill-${entry.status || entry.to_status || ""}" style="font-size: 0.72rem;">
                <i class="bi ${STATUS_ICONS[entry.status || entry.to_status] || "bi-circle"}"></i>
                ${statusLabel(entry.status || entry.to_status || "")}
              </span>
              ${relativeSpan(entry.created_at || entry.timestamp)}
            </div>
            ${entry.actor ? html`<div class="small text-body-secondary mt-1"><i class="bi bi-person me-1"></i>${entry.actor}</div>` : ""}
            ${entry.reason || entry.note ? html`<div class="small mt-1">${entry.reason || entry.note}</div>` : ""}
          </div>
        </div>
      `)}
    </div>
  `);
};

/* ---------- Render: line items (rich table with status controls) ---------- */

const itemStatusDot = (status) => html`
  <span class="tb-item-status">
    <span class="tb-item-dot tb-item-dot-${status || "draft"}"></span>
    ${ITEM_STATUS_LABELS[status] || status || "draft"}
  </span>
`;

const itemActions = (item) => {
  // PO and receive steps removed for now — items terminate at "quoted" (RFQ sent).
  return "";
};

const itemDetailInfo = (item) => {
  const parts = [];
  if (item.selectedVendorId) parts.push(html`<span><i class="bi bi-building me-1"></i>Vendor: ${item.selectedVendorId}</span>`);
  if (item.selectedPrice != null) parts.push(html`<span><i class="bi bi-currency-dollar me-1"></i>${item.selectedPrice}</span>`);
  if (item.poNumber) parts.push(html`<span><i class="bi bi-file-earmark me-1"></i>PO: ${item.poNumber}</span>`);
  if (item.note) parts.push(html`<span><i class="bi bi-chat-left-text me-1"></i>${item.note}</span>`);
  if (parts.length === 0) return "";
  return html`<div class="tb-item-detail">${parts}</div>`;
};

const renderItems = () => {
  const el = document.getElementById("pr-items-table");
  if (!el) return;
  const items = pr.lineItems || pr.items || [];

  if (items.length === 0) {
    el.innerHTML = toString(html`<div class="small text-body-secondary">No line items.</div>`);
    return;
  }

  el.innerHTML = toString(html`
    <div class="tb-items-table-wrap">
      <table class="tb-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Material</th>
            <th>Spec</th>
            <th class="text-end">Qty</th>
            <th>Unit</th>
            <th>Status</th>
            <th>Actions</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, i) => html`
            <tr data-item-row="${item.id}">
              <td class="text-body-secondary">${i + 1}</td>
              <td>
                ${item.materialName || item.material_name || "--"}
                ${itemDetailInfo(item)}
              </td>
              <td>${item.specification || "--"}</td>
              <td class="text-end tb-mono">${item.quantity != null ? item.quantity : "--"}</td>
              <td>${item.unit || "--"}</td>
              <td>${itemStatusDot(item.status)}</td>
              <td>${itemActions(item)}</td>
              <td>
                <button type="button" class="btn btn-sm btn-link p-0" data-item-action="toggle-timeline" data-item-id="${item.id}" title="Show history">
                  <i class="bi bi-clock-history"></i>
                </button>
              </td>
            </tr>
            <tr class="d-none" data-item-timeline-row="${item.id}">
              <td colspan="8">
                <div class="tb-item-timeline" id="item-timeline-${item.id}">
                  <div class="small text-body-secondary">Loading...</div>
                </div>
              </td>
            </tr>
            <tr class="d-none" data-item-form-row="${item.id}">
              <td colspan="8" id="item-form-${item.id}"></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `);
};

/* ---------- Render: vendor shortlist ---------- */

const renderShortlist = () => {
  const section = document.getElementById("pr-shortlist-section");
  const el = document.getElementById("pr-shortlist");
  if (!section || !el) return;

  const show = pr.shortlist && pr.shortlist.length > 0;
  if (!show) { el.innerHTML = toString(html`<div class="small text-body-secondary">No vendors shortlisted yet.</div>`); return; }

  el.innerHTML = toString(html`
    <div class="d-flex flex-wrap gap-2">
      ${pr.shortlist.map((v) => html`
        <div class="tb-vendor-chip">
          <i class="bi bi-building me-1"></i>${v.name || v.vendor_name || v.id}
          ${v.email ? html`<span class="text-body-secondary small ms-1">(${v.email})</span>` : ""}
        </div>
      `)}
    </div>
  `);
};

/* ---------- Render: RFQ status ---------- */

const renderRfqStatus = () => {
  const section = document.getElementById("pr-rfq-section");
  const el = document.getElementById("pr-rfq-status");
  if (!section || !el) return;

  const rfqStatuses = pr.rfq_statuses || pr.rfq_status || [];
  const showStatuses = new Set(["processing", "processing", "completed"]);
  const show = rfqStatuses.length > 0 && showStatuses.has(pr.status);
  if (!show) { el.innerHTML = toString(html`<div class="small text-body-secondary">No RFQs sent yet.</div>`); return; }

  el.innerHTML = toString(html`
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0">
        <thead>
          <tr>
            <th scope="col">Vendor</th>
            <th scope="col">Email</th>
            <th scope="col">Status</th>
            <th scope="col">Sent</th>
            <th scope="col">Responded</th>
          </tr>
        </thead>
        <tbody>
          ${rfqStatuses.map((r) => html`
            <tr>
              <td>${r.vendor_name || r.name || "--"}</td>
              <td class="tb-mono small">${r.email || "--"}</td>
              <td>
                <span class="tb-rfq-indicator tb-rfq-indicator-${r.status || "pending"}">
                  ${statusLabel(r.status || "pending")}
                </span>
              </td>
              <td>${relativeSpan(r.sent_at)}</td>
              <td>${relativeSpan(r.responded_at)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `);
};

/* ---------- Render: comparison ---------- */

const renderComparison = () => {
  const section = document.getElementById("pr-comparison-section");
  const el = document.getElementById("pr-comparison");
  if (!section || !el) return;

  const show = comparison && comparison.quotes && comparison.quotes.length > 0;
  if (!show) { el.innerHTML = toString(html`<div class="small text-body-secondary">No quotes to compare yet.</div>`); return; }

  const quotes = comparison.quotes;

  el.innerHTML = toString(html`
    <div class="table-responsive">
      <table class="table table-sm tb-comparison-table align-middle mb-0">
        <thead>
          <tr>
            <th scope="col">Vendor</th>
            <th scope="col" class="text-end">Unit Price</th>
            <th scope="col" class="text-end">Total</th>
            <th scope="col" class="text-end">Lead Time</th>
            <th scope="col">Notes</th>
            <th scope="col">Recommended</th>
          </tr>
        </thead>
        <tbody>
          ${quotes.map((q) => html`
            <tr class="${q.recommended ? "table-success" : ""}">
              <td>${q.vendor_name || "--"}</td>
              <td class="text-end tb-mono">${q.unit_price != null ? q.unit_price.toLocaleString() : "--"}</td>
              <td class="text-end tb-mono fw-semibold">${q.total != null ? q.total.toLocaleString() : "--"}</td>
              <td class="text-end">${q.lead_time_days != null ? `${q.lead_time_days}d` : "--"}</td>
              <td class="small">${q.notes || "--"}</td>
              <td class="text-center">${q.recommended ? html`<i class="bi bi-star-fill text-warning"></i>` : ""}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `);
};

/* ---------- Render all ---------- */

const renderAll = () => {
  renderHeader();
  renderActions();
  renderTimeline();
  renderItems();
  renderShortlist();
  renderRfqStatus();
  renderComparison();
  renderAgentResult();
  renderDebugLog();
};

const renderAgentResult = async () => {
  const el = document.getElementById("pr-agent-result");
  if (!el || !pr?.sourcingTaskId) return;
  try {
    const res = await fetch(`/api/tasks/${pr.sourcingTaskId}`);
    if (!res.ok) {
      el.innerHTML = '<div class="text-body-secondary small">No agent result yet.</div>';
      return;
    }
    const task = await res.json();
    if (!task.result) {
      el.innerHTML = `<div class="text-body-secondary small">Agent task is <span class="badge bg-secondary">${task.status}</span> — result will appear here when submit_result is called.</div>`;
      return;
    }
    el.innerHTML = toString(html`
      <div class="d-flex gap-2 align-items-center mb-2 small text-body-secondary">
        <span class="badge bg-success">${task.status}</span>
        <span><i class="bi bi-robot me-1"></i>${task.agentId || "—"}</span>
        ${task.model ? html`<span><i class="bi bi-cpu me-1"></i>${task.model}</span>` : ""}
        ${task.totalTokens ? html`<span><i class="bi bi-coin me-1"></i>${task.totalTokens.toLocaleString()} tokens</span>` : ""}
      </div>
      <div class="tb-prose">${raw(window.marked && window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(task.result)) : "<pre>" + task.result.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c])) + "</pre>")}</div>
      <details class="mt-3">
        <summary class="small text-body-secondary">Show raw markdown</summary>
        <pre class="tb-codeblock small mt-2">${task.result}</pre>
      </details>
    `);
  } catch (err) {
    el.innerHTML = `<div class="text-danger small">Failed to load agent result: ${err.message}</div>`;
  }
};

const renderDebugLog = async () => {
  const el = document.getElementById("pr-debug-log");
  if (!el) return;
  try {
    const res = await fetch(`/api/procurement/prs/${pr.id}/debug-log`);
    if (!res.ok) return;
    const { log } = await res.json();
    if (!log || log.length === 0) {
      el.innerHTML = '<div class="text-body-secondary small">No agent activity yet. Will populate when an agent calls submit_vendor_shortlist or the decision engine runs.</div>';
      return;
    }
    el.innerHTML = toString(html`
      <div class="tb-debug-log">
        ${log.slice().reverse().map(entry => html`
          <details class="tb-debug-entry">
            <summary>
              <span class="tb-mono small text-body-secondary">${new Date(entry.ts).toLocaleTimeString()}</span>
              <span class="badge bg-secondary ms-2">${entry.type}</span>
            </summary>
            <pre class="tb-codeblock small mt-2">${JSON.stringify(entry.data, null, 2)}</pre>
          </details>
        `)}
      </div>
    `);
  } catch (err) {
    el.innerHTML = `<div class="text-danger small">Failed to load debug log: ${err.message}</div>`;
  }
};

/* ---------- Item action handlers ---------- */

const updateItemStatus = async (itemId, status, extra = {}) => {
  const id = prId();
  if (!id) return;
  try {
    await api(`/api/procurement/prs/${id}/items/${itemId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...extra }),
    });
    toast(`Item ${status}`);
    await loadPr();
  } catch (err) {
    toast(err.message || "Failed to update item status");
    console.error("[item-status]", err);
  }
};

const showVendorSelectForm = (itemId) => {
  const formRow = document.querySelector(`[data-item-form-row="${itemId}"]`);
  if (!formRow) return;
  formRow.classList.remove("d-none");

  const items = pr.lineItems || pr.items || [];
  const item = items.find((i) => i.id === itemId || String(i.id) === String(itemId));
  const shortlist = pr.shortlist || [];

  const container = document.getElementById(`item-form-${itemId}`);
  if (!container) return;

  container.innerHTML = toString(html`
    <div class="tb-item-inline-form" data-vendor-form="${itemId}">
      <select data-field="vendor">
        <option value="">Select vendor...</option>
        ${shortlist.map((v) => html`<option value="${v.id || v.vendor_id}">${v.name || v.vendor_name || v.id}</option>`)}
      </select>
      <input type="number" step="0.01" placeholder="Price" data-field="price"
        value="${item && item.selectedPrice != null ? item.selectedPrice : ""}" />
      <button type="button" class="btn btn-sm btn-primary" data-item-action="confirm-vendor" data-item-id="${itemId}">Confirm</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-item-action="cancel-form" data-item-id="${itemId}">Cancel</button>
    </div>
  `);
};

const showPoForm = (itemId) => {
  const formRow = document.querySelector(`[data-item-form-row="${itemId}"]`);
  if (!formRow) return;
  formRow.classList.remove("d-none");

  const container = document.getElementById(`item-form-${itemId}`);
  if (!container) return;

  container.innerHTML = toString(html`
    <div class="tb-item-inline-form" data-po-form="${itemId}">
      <input type="text" placeholder="PO Number" data-field="po" />
      <button type="button" class="btn btn-sm btn-primary" data-item-action="confirm-po" data-item-id="${itemId}">Confirm</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-item-action="cancel-form" data-item-id="${itemId}">Cancel</button>
    </div>
  `);
};

const loadItemTimeline = async (itemId) => {
  const id = prId();
  const el = document.getElementById(`item-timeline-${itemId}`);
  if (!el) return;
  try {
    const tl = await api(`/api/procurement/prs/${id}/items/${itemId}/timeline`);
    const entries = tl.entries || tl.timeline || [];
    if (entries.length === 0) {
      el.innerHTML = toString(html`<div class="small text-body-secondary">No history yet.</div>`);
      return;
    }
    el.innerHTML = toString(html`
      ${entries.map((e) => html`
        <div class="tb-item-timeline-entry">
          ${itemStatusDot(e.toStatus || e.to_status)}
          <span class="text-body-secondary">${relativeSpan(e.createdAt || e.created_at)}</span>
          ${e.changedBy || e.changed_by ? html`<span class="text-body-secondary"><i class="bi bi-person me-1"></i>${e.changedBy || e.changed_by}</span>` : ""}
          ${e.note ? html`<span>${e.note}</span>` : ""}
        </div>
      `)}
    `);
  } catch {
    el.innerHTML = toString(html`<div class="small text-body-secondary">Failed to load timeline.</div>`);
  }
};

const handleItemAction = async (action, itemId, target) => {
  switch (action) {
    case "select-vendor":
      showVendorSelectForm(itemId);
      break;

    case "confirm-vendor": {
      const form = document.querySelector(`[data-vendor-form="${itemId}"]`);
      if (!form) return;
      const vendorId = form.querySelector("[data-field='vendor']")?.value;
      const price = parseFloat(form.querySelector("[data-field='price']")?.value);
      if (!vendorId) { toast("Please select a vendor"); return; }
      await updateItemStatus(itemId, "selected", {
        selectedVendorId: vendorId,
        ...(isNaN(price) ? {} : { selectedPrice: price }),
      });
      break;
    }

    case "create-po":
      showPoForm(itemId);
      break;

    case "confirm-po": {
      const form = document.querySelector(`[data-po-form="${itemId}"]`);
      if (!form) return;
      const poNumber = form.querySelector("[data-field='po']")?.value?.trim();
      if (!poNumber) { toast("Please enter a PO number"); return; }
      await updateItemStatus(itemId, "ordered", { poNumber });
      break;
    }

    case "mark-received":
      if (!confirm("Mark this item as received?")) return;
      await updateItemStatus(itemId, "received");
      break;

    case "cancel-form": {
      const formRow = document.querySelector(`[data-item-form-row="${itemId}"]`);
      if (formRow) formRow.classList.add("d-none");
      break;
    }

    case "toggle-timeline": {
      const timelineRow = document.querySelector(`[data-item-timeline-row="${itemId}"]`);
      if (!timelineRow) return;
      const isHidden = timelineRow.classList.contains("d-none");
      timelineRow.classList.toggle("d-none");
      if (isHidden) loadItemTimeline(itemId);
      break;
    }
  }
};

/* ---------- Action handlers ---------- */

const handleAction = async (action) => {
  const id = prId();
  if (!id) return;

  try {
    switch (action) {
      case "approve":
        await api(`/api/procurement/prs/${id}/approve`, { method: "POST" });
        toast("PR approved");
        break;

      case "reject": {
        const modal = document.getElementById("pr-reject-modal");
        const bsModal = window.bootstrap?.Modal?.getOrCreateInstance(modal);
        bsModal?.show();
        return; // handled by modal confirm button
      }

      case "start-sourcing":
        await api(`/api/procurement/prs/${id}/start-sourcing`, { method: "POST" });
        toast("Sourcing started");
        break;

      case "cancel":
        if (!confirm("Cancel this purchase request? This cannot be undone.")) return;
        await api(`/api/procurement/prs/${id}/cancel`, { method: "POST" });
        toast("PR cancelled");
        break;

      case "duplicate": {
        const dup = await api(`/api/procurement/prs/${id}/duplicate`, { method: "POST" });
        toast("PR duplicated as draft");
        window.location.href = `/procurement-detail.html?id=${dup.id}`;
        return;
      }

      case "reprocess":
        if (!confirm("Reset this PR and re-run sourcing? Items will be reset to draft.")) return;
        await api(`/api/procurement/prs/${id}/reprocess`, { method: "POST" });
        toast("PR queued for re-sourcing");
        break;

      default:
        return;
    }
    await loadPr();
  } catch (err) {
    toast(err.message || "Action failed");
    console.error("[pr-detail]", err);
  }
};

/* ---------- Event wiring ---------- */

const bindTabs = () => {
  const tabs = document.querySelectorAll(".tb-tab[data-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".tb-tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const panel = document.getElementById(`panel-${tab.getAttribute("data-tab")}`);
      if (panel) panel.classList.add("active");
    });
  });
};

const bindEvents = () => {
  // Tab switching
  bindTabs();

  // Delegated action clicks
  const actionsEl = document.getElementById("pr-actions");
  if (actionsEl) {
    actionsEl.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      e.preventDefault();
      handleAction(target.getAttribute("data-action"));
    });
  }

  // Delegated item action clicks
  const itemsSection = document.getElementById("pr-items-section");
  if (itemsSection) {
    itemsSection.addEventListener("click", (e) => {
      const target = e.target.closest("[data-item-action]");
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const action = target.getAttribute("data-item-action");
      const itemId = target.getAttribute("data-item-id");
      if (action && itemId) handleItemAction(action, itemId, target);
    });
  }

  // Reject modal confirm
  const rejectBtn = document.getElementById("pr-reject-confirm");
  if (rejectBtn) {
    rejectBtn.addEventListener("click", async () => {
      const id = prId();
      const reason = document.getElementById("pr-reject-reason")?.value?.trim() || "";
      try {
        await api(`/api/procurement/prs/${id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        const modal = document.getElementById("pr-reject-modal");
        window.bootstrap?.Modal?.getInstance(modal)?.hide();
        toast("PR rejected");
        await loadPr();
      } catch (err) {
        toast(err.message || "Rejection failed");
      }
    });
  }
};

/* ---------- SSE ---------- */

const bindSse = () => {
  const id = prId();
  if (!id) return;

  const es = new EventSource("/api/events");

  const prEvents = [
    "pr.updated", "pr.approved", "pr.submitted",
    "pr.cancelled", "pr.completed", "pr.processing",
    "pr.failed", "pr.sourcing_started", "item.status_changed",
  ];

  for (const ev of prEvents) {
    es.addEventListener(ev, (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.id === id) {
          pr = data;
          renderAll();
        }
      } catch { /* ignore */ }
    });
  }
};

/* ---------- Boot ---------- */

const boot = () => {
  const settings = loadSettings();
  applyTheme(settings.theme);
  renderChrome();
  bindEvents();
  bindSse();
  loadPr();

  // Relative time ticker
  setInterval(() => {
    document.querySelectorAll(".tb-relative-time[data-tb-rel]").forEach((el) => {
      const ms = Number(el.getAttribute("data-tb-rel"));
      if (ms) el.textContent = relativeTime(ms);
    });
  }, 30000);
};

boot();
