/* ============================================================
   Dashboard page — thin orchestrator. Wires the store, render
   functions, action handlers, and tickers together.
   ============================================================ */

import { renderChrome, setPendingCount, loadSettings, saveSettings, relativeTime } from "./chrome.js";
import {
  renderList, renderPagination, renderToolbar, formatDuration,
} from "./task-render.js";
import {
  loadTasks, bindListDelegation, bindPaginationDelegation,
  bindToolbar, bindSubmitForm, bindSse,
} from "./task-actions.js";
import { createTaskStore } from "./task-state.js";

const store = createTaskStore();

const render = () => {
  const view = store.paged();
  renderList(store, view);
  renderPagination(store, view);
  setPendingCount(store.pendingCount());
};

/* ---------- Tickers: in-place DOM mutation, no re-render ---------- */

/** 1 Hz: update the live elapsed pill inside every running task card. */
const tickElapsed = () => {
  const now = Date.now();
  document.querySelectorAll(".tb-elapsed-live[data-since]").forEach((el) => {
    const since = Number(el.getAttribute("data-since"));
    if (!since) return;
    const txt = el.querySelector(".tb-elapsed-text");
    if (txt) txt.textContent = formatDuration(now - since);
  });
};

/** 30 s: refresh relative timestamps ("2 minutes ago") in place. */
const tickRelativeTimes = () => {
  document.querySelectorAll(".tb-relative-time[data-tb-rel]").forEach((el) => {
    const ms = Number(el.getAttribute("data-tb-rel"));
    if (!ms) return;
    el.textContent = relativeTime(ms);
  });
};

/* ---------- Boot sequence ---------- */

const boot = () => {
  // Restore persisted UI preferences before first render.
  const settings = loadSettings();
  store.state.status   = settings.defaultStatus || "all";
  store.state.sort     = settings.defaultSort || "newest";
  store.state.pageSize = settings.pageSize || 10;

  // Shell chrome (navbar, modals, theme).
  renderChrome();

  // Paint the toolbar once, then wire its controls.
  renderToolbar(store);
  bindToolbar(store, {
    onChange: render,
    onReload: () => loadTasks(store, { onChange: render, announce: false }),
    saveSettings,
  });

  // Empty render so the skeleton shows while the first fetch is in flight.
  render();

  // Form + delegated handlers + SSE subscription.
  bindSubmitForm(store, render);
  bindListDelegation(store, render);
  bindPaginationDelegation(store, render);
  bindSse(store, render);

  // Initial data fetch.
  loadTasks(store, { onChange: render, announce: false });

  // Start tickers.
  setInterval(tickElapsed, 1000);
  setInterval(tickRelativeTimes, 30000);
};

boot();
