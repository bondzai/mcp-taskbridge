/* ============================================================
   Vendor management page — CRUD, search, materials, import.
   Refactored to use createListControls for toolbar/pagination.
   ============================================================ */

import { renderChrome, loadSettings, applyTheme, toast } from "./chrome.js";
import { html, raw, toString } from "./html.js";
import { createListControls } from "./list-controls.js";

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

const state = {
  vendors: [],
  loading: true,
  expandedMaterials: new Set(), // vendor ids with materials panel open
  expandedKpis: new Set(), // vendor ids with KPI panel open
  kpiCache: new Map(), // vendor id -> kpi data
  editingId: null, // vendor id being edited in modal
};

/* ---------- List controls ---------- */

let controls = null;

const getCategories = () => {
  const cats = new Set();
  for (const v of state.vendors) {
    if (Array.isArray(v.categories)) {
      for (const c of v.categories) cats.add(c);
    }
  }
  return [...cats].sort();
};

const rebuildControls = () => {
  const categories = getCategories();
  controls.render({
    views: ["list", "grid"],
    defaultView: "list",
    sorts: [
      { value: "name-asc", label: "Name A-Z" },
      { value: "name-desc", label: "Name Z-A" },
      { value: "materials", label: "Most materials" },
      { value: "lead-time", label: "Lead time (fastest)" },
    ],
    defaultSort: "name-asc",
    filters: [
      {
        id: "category",
        label: "Category",
        options: [
          { value: "", label: "All categories" },
          ...categories.map((c) => ({ value: c, label: c })),
        ],
      },
      {
        id: "active",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
          { value: "all", label: "All" },
        ],
      },
    ],
    pageSize: 10,
    pageSizes: [10, 25, 50],
    totalItems: filtered().length,
    searchPlaceholder: "Search name, email, category...",
  });
};

/* ---------- Load ---------- */

const loadVendors = async () => {
  try {
    state.loading = true;
    render();
    // Load all vendors (active + inactive) so client-side filtering works
    const body = await api("/api/procurement/vendors?active=all");
    state.vendors = body.vendors || [];
    state.loading = false;
    rebuildControls();
    render();
  } catch (err) {
    state.loading = false;
    render();
    toast("Failed to load vendors");
    console.error("[vendors]", err);
  }
};

/* ---------- Filtering / sorting / pagination ---------- */

const filtered = () => {
  const cs = controls ? controls.getState() : { search: "", filters: {} };
  const q = (cs.search || "").trim().toLowerCase();
  const catFilter = cs.filters.category || "";
  const activeFilter = cs.filters.active || "active";
  let list = [...state.vendors];

  // Active filter
  if (activeFilter === "active") list = list.filter((v) => v.active !== false);
  else if (activeFilter === "inactive") list = list.filter((v) => v.active === false);

  // Category filter
  if (catFilter) {
    list = list.filter((v) =>
      Array.isArray(v.categories) && v.categories.some((c) => c === catFilter)
    );
  }

  // Search
  if (q) {
    list = list.filter((v) =>
      (v.name || "").toLowerCase().includes(q) ||
      (v.email || "").toLowerCase().includes(q) ||
      (v.categories || []).some((c) => c.toLowerCase().includes(q))
    );
  }

  // Sort
  const sort = cs.sort || "name-asc";
  list.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return (a.name || "").localeCompare(b.name || "");
      case "name-desc":
        return (b.name || "").localeCompare(a.name || "");
      case "materials":
        return (b.material_count ?? 0) - (a.material_count ?? 0);
      case "lead-time":
        return (a.lead_time_days ?? 999) - (b.lead_time_days ?? 999);
      default:
        return 0;
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
  const end = Math.min(start + pageSize, total);
  return { list, slice: list.slice(start, end), total, pageCount, start, end };
};

/* ---------- Render helpers ---------- */

const formatDate = (raw) => {
  if (raw == null) return null;
  // Postgres BIGINT comes back as a string; coerce before passing to Date.
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const vendorCardList = (v) => {
  const cats = Array.isArray(v.categories) ? v.categories : [];
  const materialsExpanded = state.expandedMaterials.has(v.id);
  const kpisExpanded = state.expandedKpis.has(v.id);
  const isInactive = v.active === false;
  const matCount = v.material_count ?? v.materials?.length ?? 0;
  const isAiCreated = typeof v.notes === "string" && v.notes.startsWith("Auto-created by agent");
  const createdAtLabel = formatDate(v.created_at ?? v.createdAt);

  // Compact one-row header. Expansion (materials / KPIs) renders inline below.
  return html`
    <div class="tb-vendor-row ${isInactive ? "tb-vendor-inactive" : ""}" data-vendor-id="${v.id}">
      <div class="tb-vendor-row-main">
        <div class="tb-vendor-row-name">
          <i class="bi bi-building text-body-secondary"></i>
          <span class="fw-semibold text-truncate">${v.name || "Unnamed"}</span>
          ${isAiCreated ? html`<span class="tb-pill tb-pill-info" title="${v.notes}"><i class="bi bi-robot"></i>AI</span>` : ""}
          ${isInactive ? html`<span class="tb-pill tb-pill-cancelled"><i class="bi bi-slash-circle"></i>inactive</span>` : ""}
        </div>
        <div class="tb-vendor-row-meta text-body-secondary small">
          ${v.email ? html`<span class="text-truncate"><i class="bi bi-envelope me-1"></i>${v.email}</span>` : ""}
          ${cats.length > 0 ? html`<span class="text-truncate"><i class="bi bi-tags me-1"></i>${cats.join(", ")}</span>` : ""}
          ${v.lead_time_days != null ? html`<span><i class="bi bi-clock me-1"></i>${v.lead_time_days}d</span>` : ""}
          <span><i class="bi bi-box me-1"></i>${matCount}</span>
          ${createdAtLabel ? html`<span title="Created ${createdAtLabel}"><i class="bi bi-calendar3 me-1"></i>${createdAtLabel}</span>` : ""}
        </div>
        <div class="tb-vendor-row-actions">
          <button type="button" class="tb-icon-btn ${materialsExpanded ? "active" : ""}" data-action="toggle-materials" data-id="${v.id}" title="Materials">
            <i class="bi bi-box"></i>
          </button>
          <button type="button" class="tb-icon-btn ${kpisExpanded ? "active" : ""}" data-action="toggle-kpis" data-id="${v.id}" title="KPIs">
            <i class="bi bi-graph-up"></i>
          </button>
          <button type="button" class="tb-icon-btn" data-action="edit-vendor" data-id="${v.id}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <div class="dropdown">
            <button type="button" class="tb-icon-btn" data-bs-toggle="dropdown" aria-label="More" title="More">
              <i class="bi bi-three-dots"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              ${isInactive
                ? html`<li><button class="dropdown-item" data-action="activate-vendor" data-id="${v.id}"><i class="bi bi-check-circle me-2"></i>Activate</button></li>`
                : html`<li><button class="dropdown-item text-danger" data-action="deactivate-vendor" data-id="${v.id}"><i class="bi bi-slash-circle me-2"></i>Deactivate</button></li>`
              }
            </ul>
          </div>
        </div>
      </div>
      ${materialsExpanded ? html`
        <div class="tb-vendor-row-expand">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="tb-section-label mb-0">Materials</span>
            <button type="button" class="btn btn-outline-primary btn-sm" data-action="add-material" data-id="${v.id}">
              <i class="bi bi-plus-lg me-1"></i>Add
            </button>
          </div>
          ${v.materials && v.materials.length > 0
            ? html`
              <div class="table-responsive">
                <table class="table table-sm mb-0">
                  <thead>
                    <tr><th>Name</th><th>Category</th><th class="text-end">Unit Price</th><th>Unit</th></tr>
                  </thead>
                  <tbody>
                    ${v.materials.map((m) => html`
                      <tr>
                        <td>${m.name || "--"}</td>
                        <td>${m.category || "--"}</td>
                        <td class="text-end tb-mono">${m.unit_price != null ? m.unit_price.toLocaleString() : "--"}</td>
                        <td>${m.unit || "--"}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            `
            : html`<div class="small text-body-secondary">No materials listed.</div>`
          }
        </div>
      ` : ""}
      ${kpisExpanded ? html`<div class="tb-vendor-row-expand">${renderKpiSection(v.id)}</div>` : ""}
    </div>
  `;
};

const vendorCardGrid = (v) => {
  const cats = Array.isArray(v.categories) ? v.categories : [];
  const isInactive = v.active === false;
  const matCount = v.material_count ?? v.materials?.length ?? 0;
  const isAiCreated = typeof v.notes === "string" && v.notes.startsWith("Auto-created by agent");
  const createdAtLabel = formatDate(v.created_at ?? v.createdAt);

  return html`
    <div class="tb-vendor-card-grid ${isInactive ? "tb-vendor-inactive" : ""}" data-vendor-id="${v.id}">
      <div class="tb-vendor-card-name">
        ${v.name || "Unnamed"}
        ${isAiCreated ? html`<span class="badge bg-info bg-opacity-25 text-info border border-info border-opacity-50" style="font-size:0.7rem" title="${v.notes}"><i class="bi bi-robot me-1"></i>AI sourced</span>` : ""}
        ${isInactive ? html`<span class="tb-pill tb-pill-cancelled" style="font-size:0.7rem"><i class="bi bi-slash-circle"></i>inactive</span>` : ""}
      </div>
      ${v.email ? html`<div class="tb-vendor-card-email">${v.email}</div>` : ""}
      ${cats.length > 0 ? html`<div class="tb-vendor-card-cats">${cats.join(", ")}</div>` : ""}
      <div class="tb-vendor-card-meta">
        ${matCount} material${matCount !== 1 ? "s" : ""}${v.lead_time_days != null ? html` &middot; ${v.lead_time_days}d lead time` : ""}${createdAtLabel ? html` &middot; added ${createdAtLabel}` : ""}
      </div>
      <div class="tb-vendor-card-actions">
        <button type="button" class="btn btn-outline-info btn-sm" data-action="toggle-kpis" data-id="${v.id}">
          <i class="bi bi-graph-up me-1"></i>KPIs
        </button>
        <button type="button" class="btn btn-outline-primary btn-sm" data-action="edit-vendor" data-id="${v.id}">
          <i class="bi bi-pencil me-1"></i>Edit
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-action="toggle-materials" data-id="${v.id}">
          <i class="bi bi-box me-1"></i>Materials
        </button>
      </div>
    </div>
  `;
};

/* ---------- KPI helpers ---------- */

const kpiColorClass = (metric, value) => {
  if (value == null) return "";
  if (metric === "responseRate") {
    if (value > 0.8) return "tb-kpi-good";
    if (value >= 0.5) return "tb-kpi-warn";
    return "tb-kpi-bad";
  }
  if (metric === "winRate") {
    if (value > 0.6) return "tb-kpi-good";
    if (value >= 0.3) return "tb-kpi-warn";
    return "";
  }
  if (metric === "avgResponseDays") {
    if (value < 3) return "tb-kpi-good";
    if (value <= 7) return "tb-kpi-warn";
    return "tb-kpi-bad";
  }
  return "";
};

const fmtPct = (v) => v != null ? `${Math.round(v * 100)}%` : "--";
const fmtDays = (v) => v != null ? `${v.toFixed(1)}d` : "--";
const fmtValue = (v, currency) => {
  if (v == null) return "--";
  if (v >= 1000) return `${currency === "USD" ? "$" : ""}${(v / 1000).toFixed(1)}K`;
  return `${currency === "USD" ? "$" : ""}${v.toFixed(0)}`;
};

const renderKpiSection = (vendorId) => {
  const kpi = state.kpiCache.get(vendorId);
  if (!kpi) {
    return html`
      <div class="mt-3 pt-3 border-top tb-kpi-section">
        <div class="text-center text-body-secondary py-3">
          <div class="spinner-border spinner-border-sm me-2" role="status"></div>Loading KPIs...
        </div>
      </div>
    `;
  }

  return html`
    <div class="mt-3 pt-3 border-top tb-kpi-section">
      <div class="tb-section-label mb-2">Vendor KPIs</div>
      <div class="tb-stats">
        <div class="tb-stat-card ${kpiColorClass("responseRate", kpi.responseRate)}">
          <div class="tb-stat-value">${fmtPct(kpi.responseRate)}</div>
          <div class="tb-stat-label">Response Rate</div>
        </div>
        <div class="tb-stat-card ${kpiColorClass("avgResponseDays", kpi.avgResponseDays)}">
          <div class="tb-stat-value">${fmtDays(kpi.avgResponseDays)}</div>
          <div class="tb-stat-label">Avg Resp Time</div>
        </div>
        <div class="tb-stat-card ${kpiColorClass("winRate", kpi.winRate)}">
          <div class="tb-stat-value">${fmtPct(kpi.winRate)}</div>
          <div class="tb-stat-label">Win Rate</div>
        </div>
        <div class="tb-stat-card">
          <div class="tb-stat-value">${fmtValue(kpi.totalValue, kpi.currency)}</div>
          <div class="tb-stat-label">Total Value</div>
        </div>
      </div>
      <div class="small text-body-secondary">
        PRs Served: ${kpi.prsServed} &middot; Total RFQs: ${kpi.totalRfqs}
      </div>
    </div>
  `;
};

const loadVendorKpis = async (vendorId) => {
  try {
    const kpis = await api(`/api/procurement/vendors/${vendorId}/kpis`);
    state.kpiCache.set(vendorId, kpis);
    render();
  } catch (err) {
    toast("Failed to load vendor KPIs");
    console.error("[vendors]", err);
  }
};

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
    <i class="bi bi-building" aria-hidden="true"></i>
    <div>No vendors found.</div>
    <div class="small mt-1">Add your first vendor using the button above.</div>
  </div>
`;

/* ---------- Render ---------- */

const render = () => {
  const listEl = document.getElementById("vendor-list");
  if (!listEl) return;

  listEl.setAttribute("aria-busy", state.loading ? "true" : "false");

  if (state.loading && state.vendors.length === 0) {
    listEl.innerHTML = toString(skeleton());
    return;
  }

  const view = paged();

  // Update total in controls for pagination
  if (controls) {
    controls.setState({ totalItems: view.total });
  }

  if (view.total === 0) {
    listEl.innerHTML = toString(emptyState());
    return;
  }

  const cs = controls ? controls.getState() : { view: "list" };
  const isGrid = cs.view === "grid";

  if (isGrid) {
    listEl.innerHTML = toString(html`
      <div class="tb-grid">${view.slice.map(vendorCardGrid)}</div>
    `);
  } else {
    listEl.innerHTML = toString(html`
      <div class="tb-list">${view.slice.map(vendorCardList)}</div>
    `);
  }
};

/* ---------- Modal helpers ---------- */

const openVendorModal = (vendor = null) => {
  state.editingId = vendor?.id || null;
  const actionLabel = document.getElementById("vendor-modal-action");
  if (actionLabel) actionLabel.textContent = vendor ? "Edit" : "Add";

  const form = document.getElementById("vendor-form");
  if (form) form.classList.remove("was-validated");

  // Fill form fields
  const fill = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };
  fill("vendor-name", vendor?.name);
  fill("vendor-email", vendor?.email);
  fill("vendor-phone", vendor?.phone);
  fill("vendor-lead-time", vendor?.lead_time_days);
  fill("vendor-categories", Array.isArray(vendor?.categories) ? vendor.categories.join(", ") : (vendor?.categories || ""));
  fill("vendor-address", vendor?.address);
  fill("vendor-notes", vendor?.notes);

  const modal = document.getElementById("vendor-modal");
  window.bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
};

const closeVendorModal = () => {
  const modal = document.getElementById("vendor-modal");
  window.bootstrap?.Modal?.getInstance(modal)?.hide();
};

/* ---------- Save vendor ---------- */

const saveVendor = async () => {
  const form = document.getElementById("vendor-form");
  form.classList.add("was-validated");

  const name = document.getElementById("vendor-name")?.value?.trim();
  const email = document.getElementById("vendor-email")?.value?.trim();

  if (!name || !email) {
    toast("Name and email are required");
    return;
  }

  const payload = {
    name,
    email,
    phone: document.getElementById("vendor-phone")?.value?.trim() || null,
    lead_time_days: Number(document.getElementById("vendor-lead-time")?.value) || null,
    categories: (document.getElementById("vendor-categories")?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    address: document.getElementById("vendor-address")?.value?.trim() || null,
    notes: document.getElementById("vendor-notes")?.value?.trim() || null,
  };

  try {
    if (state.editingId) {
      await api(`/api/procurement/vendors/${state.editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("Vendor updated");
    } else {
      await api("/api/procurement/vendors", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("Vendor created");
    }
    closeVendorModal();
    await loadVendors();
  } catch (err) {
    toast(err.message || "Failed to save vendor");
    console.error("[vendors]", err);
  }
};

/* ---------- Action handlers ---------- */

const handleAction = async (action, id) => {
  switch (action) {
    case "edit-vendor": {
      const vendor = state.vendors.find((v) => v.id === id);
      if (vendor) openVendorModal(vendor);
      break;
    }

    case "toggle-materials": {
      if (state.expandedMaterials.has(id)) {
        state.expandedMaterials.delete(id);
      } else {
        // Load materials for this vendor if not already loaded
        const vendor = state.vendors.find((v) => v.id === id);
        if (vendor && !vendor.materials) {
          try {
            const detail = await api(`/api/procurement/vendors/${id}`);
            Object.assign(vendor, detail);
          } catch (err) {
            toast("Failed to load vendor details");
            console.error("[vendors]", err);
          }
        }
        state.expandedMaterials.add(id);
      }
      render();
      break;
    }

    case "toggle-kpis": {
      if (state.expandedKpis.has(id)) {
        state.expandedKpis.delete(id);
      } else {
        state.expandedKpis.add(id);
        if (!state.kpiCache.has(id)) {
          render(); // show spinner
          loadVendorKpis(id);
          return;
        }
      }
      render();
      break;
    }

    case "deactivate-vendor": {
      if (!confirm("Deactivate this vendor?")) return;
      try {
        await api(`/api/procurement/vendors/${id}/deactivate`, { method: "POST" });
        toast("Vendor deactivated");
        await loadVendors();
      } catch (err) {
        toast(err.message || "Failed to deactivate vendor");
      }
      break;
    }

    case "activate-vendor": {
      try {
        await api(`/api/procurement/vendors/${id}/activate`, { method: "POST" });
        toast("Vendor activated");
        await loadVendors();
      } catch (err) {
        toast(err.message || "Failed to activate vendor");
      }
      break;
    }

    case "add-material": {
      const matName = prompt("Material name:");
      if (!matName) return;
      const matUnit = prompt("Unit (e.g. kg, piece, box):") || "";
      const matPrice = prompt("Unit price:") || "";
      const matCat = prompt("Category:") || "";
      try {
        await api(`/api/procurement/vendors/${id}/materials`, {
          method: "POST",
          body: JSON.stringify({
            name: matName,
            unit: matUnit,
            unit_price: matPrice ? Number(matPrice) : null,
            category: matCat || null,
          }),
        });
        toast("Material added");
        // Refresh vendor detail
        const vendor = state.vendors.find((v) => v.id === id);
        if (vendor) {
          try {
            const detail = await api(`/api/procurement/vendors/${id}`);
            Object.assign(vendor, detail);
          } catch { /* ignore */ }
        }
        render();
      } catch (err) {
        toast(err.message || "Failed to add material");
      }
      break;
    }
  }
};

/* ---------- Import ---------- */

let importData = null;

const openImportModal = () => {
  importData = null;
  const fileInput = document.getElementById("vendor-import-file");
  const preview = document.getElementById("vendor-import-preview");
  const confirmBtn = document.getElementById("vendor-import-confirm");
  if (fileInput) fileInput.value = "";
  if (preview) preview.innerHTML = "";
  if (confirmBtn) confirmBtn.disabled = true;

  const modal = document.getElementById("vendor-import-modal");
  window.bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
};

const handleImportFile = async (file) => {
  const preview = document.getElementById("vendor-import-preview");
  const confirmBtn = document.getElementById("vendor-import-confirm");

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const vendors = Array.isArray(data) ? data : (data.vendors || []);

    if (!Array.isArray(vendors) || vendors.length === 0) {
      preview.innerHTML = '<div class="text-danger">No valid vendor data found in file.</div>';
      confirmBtn.disabled = true;
      return;
    }

    importData = vendors;
    preview.innerHTML = `<div class="text-success"><i class="bi bi-check-circle me-1"></i>${vendors.length} vendor(s) ready to import.</div>`;
    confirmBtn.disabled = false;
  } catch (err) {
    preview.innerHTML = `<div class="text-danger">Invalid JSON: ${err.message}</div>`;
    confirmBtn.disabled = true;
  }
};

const executeImport = async () => {
  if (!importData) return;

  const confirmBtn = document.getElementById("vendor-import-confirm");
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    await api("/api/procurement/vendors/import", {
      method: "POST",
      body: JSON.stringify({ vendors: importData }),
    });
    toast(`Imported ${importData.length} vendor(s)`);
    const modal = document.getElementById("vendor-import-modal");
    window.bootstrap?.Modal?.getInstance(modal)?.hide();
    importData = null;
    await loadVendors();
  } catch (err) {
    toast(err.message || "Import failed");
    if (confirmBtn) confirmBtn.disabled = false;
    console.error("[vendors]", err);
  }
};

/* ---------- Event wiring ---------- */

const bindEvents = () => {
  // Add vendor button
  const addBtn = document.getElementById("vendor-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => openVendorModal());
  }

  // Import button
  const importBtn = document.getElementById("vendor-import-btn");
  if (importBtn) {
    importBtn.addEventListener("click", () => openImportModal());
  }

  // Vendor form submit
  const vendorForm = document.getElementById("vendor-form");
  if (vendorForm) {
    vendorForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveVendor();
    });
  }

  // Import file change
  const importFile = document.getElementById("vendor-import-file");
  if (importFile) {
    importFile.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
    });
  }

  // Import confirm
  const importConfirm = document.getElementById("vendor-import-confirm");
  if (importConfirm) {
    importConfirm.addEventListener("click", () => executeImport());
  }

  // Delegated clicks on vendor list
  const listEl = document.getElementById("vendor-list");
  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      e.preventDefault();
      const action = target.getAttribute("data-action");
      const id = target.getAttribute("data-id");
      if (action && id) handleAction(action, id);
    });
  }
};

/* ---------- Boot ---------- */

const boot = () => {
  const settings = loadSettings();
  applyTheme(settings.theme);
  renderChrome();

  controls = createListControls({
    storageKey: "vendors",
    toolbarContainer: document.getElementById("vendor-toolbar"),
    paginationContainer: document.getElementById("vendor-pagination"),
    onUpdate: () => render(),
  });

  bindEvents();
  render();
  loadVendors();
};

boot();
