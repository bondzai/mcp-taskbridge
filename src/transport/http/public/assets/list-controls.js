/* ============================================================
   list-controls.js — Reusable list/grid view toggle with
   sort, filter, search, and pagination.

   Usage:
     const controls = createListControls({
       storageKey: "myPage",
       toolbarContainer: document.getElementById("toolbar"),
       paginationContainer: document.getElementById("pagination"),
       onUpdate(state) { ... },
     });
     controls.render({ sorts, filters, totalItems, ... });

   The component manages its own state (view mode, sort, search,
   page, pageSize) and persists preferences to localStorage.
   It calls onUpdate whenever any value changes so the page can
   re-fetch / re-render its data.
   ============================================================ */

import { html, raw, toString } from "./html.js";

const DEFAULTS = {
  views: ["list"],
  defaultView: "list",
  sorts: [],
  defaultSort: "",
  filters: [],
  pageSize: 10,
  pageSizes: [10, 25, 50],
  totalItems: 0,
  searchPlaceholder: "Search...",
};

const VIEW_ICONS = {
  list: "bi-list-ul",
  grid: "bi-grid-3x3-gap",
};

/**
 * createListControls(opts)
 *
 * opts.storageKey        — localStorage prefix for persisting prefs
 * opts.toolbarContainer  — DOM element for the toolbar row
 * opts.paginationContainer — DOM element for the pagination row
 * opts.onUpdate(state)   — called on every state change
 *
 * Returns { render(config), getState(), setState(patch), destroy() }
 */
export const createListControls = (opts) => {
  const {
    storageKey,
    toolbarContainer,
    paginationContainer,
    onUpdate,
  } = opts;

  /* ---------- State ---------- */

  const lsKey = `tb.listControls.${storageKey}`;

  const loadPersistedState = () => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const persistState = () => {
    try {
      localStorage.setItem(lsKey, JSON.stringify({
        view: state.view,
        sort: state.sort,
        pageSize: state.pageSize,
      }));
    } catch { /* quota exceeded — ignore */ }
  };

  const persisted = loadPersistedState();

  const state = {
    view: persisted.view || "list",
    sort: persisted.sort || "",
    search: "",
    page: 1,
    pageSize: persisted.pageSize || 10,
    // filters is a map: filterId -> selectedValue
    filters: {},
  };

  let config = { ...DEFAULTS };

  /* ---------- Debounce for search ---------- */

  let searchTimer = null;

  const debouncedUpdate = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      notify();
    }, 300);
  };

  /* ---------- Notify ---------- */

  const notify = () => {
    persistState();
    if (typeof onUpdate === "function") {
      onUpdate(getState());
    }
    renderPagination();
  };

  /* ---------- Public getState ---------- */

  const getState = () => ({
    view: state.view,
    sort: state.sort,
    search: state.search,
    page: state.page,
    pageSize: state.pageSize,
    filters: { ...state.filters },
  });

  /* ---------- setState (external patch) ---------- */

  const setState = (patch) => {
    if (patch.view != null) state.view = patch.view;
    if (patch.sort != null) state.sort = patch.sort;
    if (patch.search != null) state.search = patch.search;
    if (patch.page != null) state.page = patch.page;
    if (patch.pageSize != null) state.pageSize = patch.pageSize;
    if (patch.filters) Object.assign(state.filters, patch.filters);
    if (patch.totalItems != null) config.totalItems = patch.totalItems;
    persistState();
    renderPagination();
  };

  /* ---------- Toolbar rendering ---------- */

  const renderToolbar = () => {
    if (!toolbarContainer) return;

    // Apply config defaults ONLY when state is genuinely empty. The
    // `persisted` snapshot was captured at init and is stale after the
    // user changes anything — re-applying it on every render() (which is
    // what re-fetches like loadVendors() trigger) would otherwise reset
    // pageSize / view to load-time values.
    if (!state.sort && config.defaultSort) {
      state.sort = config.defaultSort;
    }
    if (!state.view && config.defaultView && config.views.includes(config.defaultView)) {
      state.view = config.defaultView;
    }
    if (state.pageSize == null && config.pageSize) {
      state.pageSize = config.pageSize;
    }

    const hasViews = config.views.length > 1;
    const hasSorts = config.sorts.length > 0;
    const hasFilters = config.filters.length > 0;
    const hasPageSizes = config.pageSizes.length > 1;

    // "Dirty" check — show the Clear button whenever any of the user's
    // filter/sort/search state differs from the first-option / default.
    const firstFilterVal = (f) => {
      if (!f.options.length) return "";
      const o = f.options[0];
      return typeof o === "string" ? o : o.value;
    };
    const isDirty = () => {
      if ((state.search || "").trim() !== "") return true;
      for (const f of config.filters) {
        const cur = state.filters[f.id];
        const def = firstFilterVal(f);
        if (cur != null && cur !== def) return true;
      }
      if (config.defaultSort && state.sort && state.sort !== config.defaultSort) return true;
      return false;
    };

    toolbarContainer.innerHTML = toString(html`
      <div class="tb-list-controls">
        <div class="tb-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <label for="lc-search-${storageKey}" class="visually-hidden">${config.searchPlaceholder}</label>
          <input id="lc-search-${storageKey}" type="search" class="form-control"
                 placeholder="${config.searchPlaceholder}" value="${state.search}"
                 data-lc-action="search" />
        </div>

        ${hasFilters ? config.filters.map((f) => html`
          <label for="lc-filter-${f.id}" class="visually-hidden">${f.label}</label>
          <select id="lc-filter-${f.id}" class="form-select form-select-sm"
                  data-lc-action="filter" data-lc-filter-id="${f.id}"
                  style="max-width:180px">
            ${f.options.map((o) => {
              const val = typeof o === "string" ? o : o.value;
              const label = typeof o === "string" ? o : o.label;
              const selected = state.filters[f.id] === val;
              return html`<option value="${val}" ${selected ? raw("selected") : ""}>${label}</option>`;
            })}
          </select>
        `) : ""}

        <div class="tb-list-controls-right">
          ${hasSorts ? html`
            <label for="lc-sort-${storageKey}" class="visually-hidden">Sort</label>
            <select id="lc-sort-${storageKey}" class="form-select form-select-sm"
                    data-lc-action="sort" style="max-width:180px">
              ${config.sorts.map((s) => html`
                <option value="${s.value}" ${s.value === state.sort ? raw("selected") : ""}>${s.label}</option>
              `)}
            </select>
          ` : ""}

          ${hasPageSizes ? html`
            <label for="lc-pagesize-${storageKey}" class="visually-hidden">Page size</label>
            <select id="lc-pagesize-${storageKey}" class="form-select form-select-sm"
                    data-lc-action="pagesize" style="max-width:100px">
              ${config.pageSizes.map((n) => html`
                <option value="${n}" ${n === state.pageSize ? raw("selected") : ""}>${n}/page</option>
              `)}
            </select>
          ` : ""}

          ${isDirty() ? html`
            <button type="button" class="btn btn-sm btn-outline-secondary"
                    data-lc-action="clear" title="Clear search, filters, and sort"
                    aria-label="Clear filters">
              <i class="bi bi-x-circle me-1"></i>Clear
            </button>
          ` : ""}

          ${hasViews ? html`
            <div class="tb-view-toggle" role="group" aria-label="View mode">
              ${config.views.map((v) => html`
                <button type="button" class="${v === state.view ? "active" : ""}"
                        data-lc-action="view" data-lc-view="${v}"
                        title="${v} view" aria-label="${v} view"
                        aria-pressed="${v === state.view ? "true" : "false"}">
                  <i class="bi ${VIEW_ICONS[v] || "bi-list-ul"}"></i>
                </button>
              `)}
            </div>
          ` : ""}
        </div>
      </div>
    `);

    bindToolbarEvents();
  };

  /* ---------- Pagination rendering ---------- */

  const renderPagination = () => {
    if (!paginationContainer) return;

    const total = config.totalItems;
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pageCount) state.page = pageCount;
    if (state.page < 1) state.page = 1;

    const start = (state.page - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, total);

    if (total <= 0) {
      paginationContainer.innerHTML = "";
      return;
    }

    paginationContainer.innerHTML = toString(html`
      <span>Showing ${start + 1}--${end} of ${total}</span>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-outline-secondary btn-sm"
                ${state.page <= 1 ? raw("disabled") : ""}
                data-lc-action="page-prev">
          <i class="bi bi-chevron-left"></i> Prev
        </button>
        <span aria-live="polite">Page ${state.page} / ${pageCount}</span>
        <button class="btn btn-outline-secondary btn-sm"
                ${state.page >= pageCount ? raw("disabled") : ""}
                data-lc-action="page-next">
          Next <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    `);

    bindPaginationEvents();
  };

  /* ---------- Event binding (delegated) ---------- */

  const bindToolbarEvents = () => {
    if (!toolbarContainer) return;

    toolbarContainer.addEventListener("input", handleToolbarInput);
    toolbarContainer.addEventListener("change", handleToolbarChange);
    toolbarContainer.addEventListener("click", handleToolbarClick);
  };

  const handleToolbarInput = (e) => {
    const action = e.target.getAttribute("data-lc-action");
    if (action === "search") {
      state.search = e.target.value;
      debouncedUpdate();
    }
  };

  const handleToolbarChange = (e) => {
    const action = e.target.getAttribute("data-lc-action");
    if (!action) return;

    if (action === "sort") {
      state.sort = e.target.value;
      state.page = 1;
      notify();
    } else if (action === "pagesize") {
      state.pageSize = Number(e.target.value);
      state.page = 1;
      notify();
    } else if (action === "filter") {
      const filterId = e.target.getAttribute("data-lc-filter-id");
      state.filters[filterId] = e.target.value;
      state.page = 1;
      notify();
    }
  };

  const handleToolbarClick = (e) => {
    const clearBtn = e.target.closest("[data-lc-action='clear']");
    if (clearBtn) {
      clearFilters();
      return;
    }

    const btn = e.target.closest("[data-lc-action='view']");
    if (!btn) return;
    const view = btn.getAttribute("data-lc-view");
    if (view && view !== state.view) {
      state.view = view;
      // Update active states in the toggle
      toolbarContainer.querySelectorAll("[data-lc-action='view']").forEach((b) => {
        const isActive = b.getAttribute("data-lc-view") === view;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      notify();
    }
  };

  /* Reset search, filters (to first-option default), and sort (to defaultSort).
     Leaves view + pageSize alone — those are user prefs, not filter state. */
  const clearFilters = () => {
    state.search = "";
    state.page = 1;
    state.filters = {};
    for (const f of config.filters) {
      const o = f.options[0];
      state.filters[f.id] = o == null ? "" : (typeof o === "string" ? o : o.value);
    }
    state.sort = config.defaultSort || "";
    renderToolbar();   // refresh dropdown values + remove the Clear button
    notify();
  };

  const bindPaginationEvents = () => {
    if (!paginationContainer) return;

    // Use a single delegated listener; we re-render innerHTML each time
    // so we need to re-bind. We remove old before adding new via clone trick.
    paginationContainer.addEventListener("click", handlePaginationClick);
  };

  const handlePaginationClick = (e) => {
    const btn = e.target.closest("[data-lc-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-lc-action");
    if (action === "page-prev") {
      state.page = Math.max(1, state.page - 1);
      notify();
    } else if (action === "page-next") {
      state.page += 1;
      notify();
    }
  };

  /* ---------- Public render ---------- */

  const render = (cfg = {}) => {
    config = { ...DEFAULTS, ...cfg };
    renderToolbar();
    renderPagination();
  };

  /* ---------- Cleanup ---------- */

  const destroy = () => {
    clearTimeout(searchTimer);
    if (toolbarContainer) {
      toolbarContainer.removeEventListener("input", handleToolbarInput);
      toolbarContainer.removeEventListener("change", handleToolbarChange);
      toolbarContainer.removeEventListener("click", handleToolbarClick);
    }
    if (paginationContainer) {
      paginationContainer.removeEventListener("click", handlePaginationClick);
    }
  };

  return { render, getState, setState, destroy };
};
