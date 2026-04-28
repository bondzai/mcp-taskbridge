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

const TERMINAL_STATUSES = new Set(["rejected", "cancelled", "delivered"]);

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
    const compStatuses = new Set(["quotes_received", "po_issued", "delivered"]);
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
      <button type="button" class="btn btn-danger" data-action="reject">
        <i class="bi bi-x-lg me-1"></i>Reject
      </button>
    `);
  }

  if (pr.status === "approved") {
    btns.push(html`
      <button type="button" class="btn btn-primary" data-action="start-sourcing">
        <i class="bi bi-search me-1"></i>Start Sourcing
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

/* ---------- Render: line items ---------- */

const renderItems = () => {
  const el = document.getElementById("pr-items-table");
  if (!el) return;
  const items = pr.items || [];

  if (items.length === 0) {
    el.innerHTML = toString(html`<div class="small text-body-secondary">No line items.</div>`);
    return;
  }

  el.innerHTML = toString(html`
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Material</th>
            <th scope="col">Specification</th>
            <th scope="col" class="text-end">Qty</th>
            <th scope="col">Unit</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, i) => html`
            <tr>
              <td class="text-body-secondary">${i + 1}</td>
              <td>${item.material_name || "--"}</td>
              <td>${item.specification || "--"}</td>
              <td class="text-end tb-mono">${item.quantity != null ? item.quantity : "--"}</td>
              <td>${item.unit || "--"}</td>
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
  const showStatuses = new Set(["rfq_sent", "rfq_sending", "rfq_pending", "quotes_received", "awaiting_replies", "po_issued", "delivered", "completed"]);
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
    "pr.updated", "pr.approved", "pr.rejected", "pr.submitted",
    "pr.cancelled", "pr.sourcing", "pr.rfq_sent", "pr.quotes_received",
    "pr.po_issued", "pr.delivered",
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
