/* ============================================================
   Purchase History — completed PRs grouped as cards.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast, relativeTime, absoluteTime, dateTimeShort } from "./chrome.js";
import { html, toString } from "./html.js";
import { createListControls } from "./list-controls.js";

const api = async (url) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};

const state = { history: [], vendors: [], loading: true };
let controls = null;

const fmtPrice = (v, currency) => {
  if (v == null) return "—";
  const sym = { USD: "$", EUR: "€", GBP: "£", THB: "฿" }[currency] || currency || "$";
  return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtTotal = (items) => {
  const total = items.reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0);
  if (total === 0) return null;
  const currency = items.find((i) => i.currency)?.currency || "USD";
  return fmtPrice(total, currency);
};

/* ---------- Filtering ---------- */

const filtered = () => {
  const cs = controls?.getState() || {};
  const q = (cs.search || "").trim().toLowerCase();
  const vendorFilter = cs.filters?.vendor || "";

  let list = [...state.history];

  if (vendorFilter) {
    list = list.map((pr) => ({
      ...pr,
      items: pr.items.filter((i) => i.vendorId === vendorFilter),
    })).filter((pr) => pr.items.length > 0);
  }

  if (q) {
    list = list.filter((pr) =>
      (pr.prTitle || "").toLowerCase().includes(q) ||
      pr.items.some((i) => (i.materialName || "").toLowerCase().includes(q) ||
                           (i.vendorName || "").toLowerCase().includes(q))
    );
  }

  const sort = cs.sort || "newest";
  list.sort((a, b) => {
    switch (sort) {
      case "newest":  return (b.completedAt || 0) - (a.completedAt || 0);
      case "oldest":  return (a.completedAt || 0) - (b.completedAt || 0);
      case "value": {
        const ta = a.items.reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0);
        const tb = b.items.reduce((s, i) => s + ((i.unitPrice || 0) * (i.quantity || 0)), 0);
        return tb - ta;
      }
      case "items": return (b.items?.length || 0) - (a.items?.length || 0);
      default: return 0;
    }
  });

  return list;
};

const paged = () => {
  const cs = controls?.getState() || { page: 1, pageSize: 10 };
  const list = filtered();
  const pageSize = cs.pageSize || 10;
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  let page = Math.min(cs.page || 1, pageCount);
  const start = (page - 1) * pageSize;
  return { slice: list.slice(start, start + pageSize), total: list.length };
};

/* ---------- Render ---------- */

const historyCard = (pr) => {
  const total = fmtTotal(pr.items);
  const vendors = [...new Set(pr.items.map((i) => i.vendorName).filter(Boolean))];
  const domain = pr.domain || null;

  // Collapsed by default. Native <details> is accessible + needs no JS.
  return html`
    <details class="tb-history-acc">
      <summary class="tb-history-acc-summary">
        <i class="bi bi-chevron-right tb-history-acc-chevron"></i>
        <span class="tb-history-acc-title text-truncate">${pr.prTitle}</span>
        ${domain ? html`<span class="tb-domain-badge tb-domain-${domain}">${domain}</span>` : ""}
        <span class="tb-history-acc-meta">
          <span class="text-body-secondary small" title="${absoluteTime(pr.completedAt)}">
            <i class="bi bi-check-circle me-1 text-success"></i>${dateTimeShort(pr.completedAt)}
          </span>
          <span class="text-body-secondary small"><i class="bi bi-box me-1"></i>${pr.items.length}</span>
          ${vendors.length > 0 ? html`<span class="text-body-secondary small text-truncate" title="${vendors.join(', ')}"><i class="bi bi-building me-1"></i>${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}</span>` : ""}
          ${total ? html`<span class="fw-semibold tb-mono">${total}</span>` : ""}
        </span>
        <span class="tb-mono small text-body-secondary tb-history-acc-id">#${(pr.prId || "").slice(0, 8)}</span>
      </summary>
      <div class="tb-history-acc-body">
        <table class="tb-history-table">
          <thead>
            <tr>
              <th>Material</th>
              <th class="text-end">Qty</th>
              <th>Vendor</th>
              <th class="text-end">Unit Price</th>
              <th class="text-end">Total</th>
              <th class="text-end">Lead</th>
            </tr>
          </thead>
          <tbody>
            ${pr.items.map((i) => html`
              <tr>
                <td>${i.materialName}</td>
                <td class="text-end tb-mono">${i.quantity} ${i.unit || ""}</td>
                <td>${i.vendorName || "—"}</td>
                <td class="text-end tb-mono">${fmtPrice(i.unitPrice, i.currency)}</td>
                <td class="text-end tb-mono">${i.unitPrice && i.quantity ? fmtPrice(i.unitPrice * i.quantity, i.currency) : "—"}</td>
                <td class="text-end">${i.leadTimeDays != null ? `${i.leadTimeDays}d` : "—"}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </details>
  `;
};

const render = () => {
  const el = document.getElementById("history-list");
  if (!el) return;

  el.setAttribute("aria-busy", state.loading ? "true" : "false");

  if (state.loading && state.history.length === 0) {
    el.innerHTML = toString(html`
      <div class="tb-skeleton-list" aria-hidden="true">
        ${[0, 1, 2].map(() => html`
          <div class="tb-skeleton-card">
            <div class="tb-skeleton-line tb-skeleton-line-sm"></div>
            <div class="tb-skeleton-line tb-skeleton-line-lg"></div>
            <div class="tb-skeleton-line tb-skeleton-line-md"></div>
          </div>
        `)}
      </div>
    `);
    return;
  }

  const view = paged();
  if (controls) controls.setState({ totalItems: view.total });

  if (view.total === 0) {
    el.innerHTML = toString(html`
      <div class="tb-empty" role="status">
        <i class="bi bi-clock-history" aria-hidden="true"></i>
        <div>No completed purchases found.</div>
        <div class="small mt-1">Completed purchase requests will appear here.</div>
      </div>
    `);
    return;
  }

  el.innerHTML = toString(html`<div class="tb-list">${view.slice.map(historyCard)}</div>`);
};

/* ---------- Boot ---------- */

const boot = async () => {
  applyTheme(loadSettings().theme);
  renderChrome();

  controls = createListControls({
    storageKey: "history",
    toolbarContainer: document.getElementById("history-toolbar"),
    paginationContainer: document.getElementById("history-pagination"),
    onUpdate: () => render(),
  });

  render();

  try {
    const [histBody, vendorBody] = await Promise.all([
      api("/api/procurement/history"),
      api("/api/procurement/vendors?limit=500"),
    ]);
    state.history = histBody.history || [];
    state.vendors = vendorBody.vendors || [];
    state.loading = false;

    controls.render({
      views: ["list"],
      sorts: [
        { value: "newest", label: "Newest" },
        { value: "oldest", label: "Oldest" },
        { value: "value", label: "Highest value" },
        { value: "items", label: "Most items" },
      ],
      defaultSort: "newest",
      filters: [{
        id: "vendor",
        label: "Vendor",
        options: [
          { value: "", label: "All vendors" },
          ...state.vendors.map((v) => ({ value: v.id, label: v.name })),
        ],
      }],
      pageSize: 10,
      pageSizes: [10, 25, 50],
      totalItems: state.history.length,
      searchPlaceholder: "Search material, vendor, PR title...",
    });

    render();
  } catch (err) {
    state.loading = false;
    render();
    toast("Failed to load history");
  }
};

boot();
