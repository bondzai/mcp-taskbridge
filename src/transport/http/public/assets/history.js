/* ============================================================
   Purchase History page — search completed PRs, filter by vendor.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast, absoluteTime } from "./chrome.js";
import { html, toString } from "./html.js";

/* ---------- API ---------- */

const api = async (url) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
};

/* ---------- State ---------- */

const state = {
  history: [],
  vendors: [],
  loading: true,
  material: "",
  vendorId: "",
};

/* ---------- Load ---------- */

const loadHistory = async () => {
  try {
    state.loading = true;
    render();
    const params = new URLSearchParams();
    if (state.material.trim()) params.set("material", state.material.trim());
    if (state.vendorId) params.set("vendor_id", state.vendorId);
    const body = await api(`/api/procurement/history?${params}`);
    state.history = body.history || [];
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    render();
    toast("Failed to load history");
    console.error("[history]", err);
  }
};

const loadVendors = async () => {
  try {
    const body = await api("/api/procurement/vendors?active=true&limit=500");
    state.vendors = body.vendors || [];
    populateVendorFilter();
  } catch (err) {
    console.error("[history] failed to load vendors", err);
  }
};

const populateVendorFilter = () => {
  const select = document.getElementById("history-vendor");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">All vendors</option>';
  for (const v of state.vendors) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name || v.id;
    select.appendChild(opt);
  }
  select.value = current;
};

/* ---------- Render helpers ---------- */

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
    <i class="bi bi-clock-history" aria-hidden="true"></i>
    <div>No completed purchases found.</div>
    <div class="small mt-1">Completed purchase requests will appear here.</div>
  </div>
`;

const fmtPrice = (v) => v != null ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";

const historyTable = (history) => {
  const rows = [];
  for (const pr of history) {
    for (const item of pr.items) {
      rows.push({ ...item, prId: pr.prId, prTitle: pr.prTitle, completedAt: pr.completedAt });
    }
  }

  return html`
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>PR ID</th>
            <th>Title</th>
            <th>Material</th>
            <th class="text-end">Qty</th>
            <th>Vendor</th>
            <th class="text-end">Unit Price</th>
            <th>Currency</th>
            <th class="text-end">Lead Time</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => html`
            <tr>
              <td class="tb-mono small">${r.prId.slice(0, 8)}</td>
              <td>${r.prTitle}</td>
              <td>${r.materialName}</td>
              <td class="text-end tb-mono">${r.quantity} ${r.unit}</td>
              <td>${r.vendorName || "--"}</td>
              <td class="text-end tb-mono">${fmtPrice(r.unitPrice)}</td>
              <td>${r.currency || "--"}</td>
              <td class="text-end">${r.leadTimeDays != null ? r.leadTimeDays + "d" : "--"}</td>
              <td class="small text-body-secondary">${absoluteTime(r.completedAt)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
};

/* ---------- Render ---------- */

const render = () => {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;

  listEl.setAttribute("aria-busy", state.loading ? "true" : "false");

  if (state.loading && state.history.length === 0) {
    listEl.innerHTML = toString(skeleton());
    return;
  }

  if (state.history.length === 0) {
    listEl.innerHTML = toString(emptyState());
    return;
  }

  listEl.innerHTML = toString(historyTable(state.history));
};

/* ---------- Event wiring ---------- */

let searchTimer = null;

const bindEvents = () => {
  const materialEl = document.getElementById("history-material");
  if (materialEl) {
    materialEl.addEventListener("input", (e) => {
      state.material = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadHistory(), 300);
    });
  }

  const vendorEl = document.getElementById("history-vendor");
  if (vendorEl) {
    vendorEl.addEventListener("change", (e) => {
      state.vendorId = e.target.value;
      loadHistory();
    });
  }

  const refreshBtn = document.getElementById("history-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadHistory());
  }
};

/* ---------- Boot ---------- */

const boot = () => {
  const settings = loadSettings();
  applyTheme(settings.theme);
  renderChrome();
  bindEvents();
  render();
  loadVendors();
  loadHistory();
};

boot();
