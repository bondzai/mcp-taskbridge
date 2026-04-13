/* ============================================================
   Dashboard page: submit, filter, sort, paginate, accordion.
   ============================================================ */

import {
  renderChrome, setPendingCount, loadSettings, saveSettings,
  relativeTime, absoluteTime, toast, renderMarkdown, openPromptsModal,
} from "./chrome.js";
import { buildPrompt, copyToClipboard } from "./prompts.js";

const STATUSES = ["all", "pending", "in_progress", "done", "failed"];
const SORTS = {
  newest:  { label: "Newest first",  cmp: (a, b) => b.createdAt - a.createdAt },
  oldest:  { label: "Oldest first",  cmp: (a, b) => a.createdAt - b.createdAt },
  updated: { label: "Recently updated", cmp: (a, b) => b.updatedAt - a.updatedAt },
  status:  { label: "By status",     cmp: (a, b) => a.status.localeCompare(b.status) || b.createdAt - a.createdAt },
};
const PAGE_SIZES = [10, 25, 50, 100];

const tasks = new Map();
const state = {
  search: "",
  status: "all",
  sort: "newest",
  pageSize: 10,
  page: 1,
  expanded: new Set(),
  mode: new Map(), // taskId → "rendered" | "raw"
};

const modeFor = (id) => state.mode.get(id) || "rendered";

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
);

const shortId = (id) => id.slice(0, 8);

const statusIcon = (s) => ({
  pending: "bi-hourglass-split",
  in_progress: "bi-arrow-repeat",
  done: "bi-check-circle-fill",
  failed: "bi-x-octagon-fill",
}[s] || "bi-circle");

const getFiltered = () => {
  const q = state.search.trim().toLowerCase();
  let list = [...tasks.values()];
  if (state.status !== "all") list = list.filter((t) => t.status === state.status);
  if (q) list = list.filter((t) =>
    t.id.toLowerCase().includes(q) ||
    (t.prompt || "").toLowerCase().includes(q) ||
    (t.agentId || "").toLowerCase().includes(q) ||
    (t.result || "").toLowerCase().includes(q)
  );
  return list.sort(SORTS[state.sort].cmp);
};

const renderToolbar = () => {
  const el = document.getElementById("tb-toolbar");
  if (!el) return;
  el.innerHTML = `
    <div class="tb-search">
      <i class="bi bi-search"></i>
      <input id="tb-q" type="search" class="form-control" placeholder="Search id, prompt, agent, result…" value="${escape(state.search)}">
    </div>
    <select id="tb-status" class="form-select" style="max-width:160px">
      ${STATUSES.map((s) => `<option value="${s}" ${s === state.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}
    </select>
    <select id="tb-sort" class="form-select" style="max-width:190px">
      ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>${v.label}</option>`).join("")}
    </select>
    <select id="tb-pagesize" class="form-select" style="max-width:110px" title="Page size">
      ${PAGE_SIZES.map((n) => `<option value="${n}" ${n === state.pageSize ? "selected" : ""}>${n}/page</option>`).join("")}
    </select>
    <button id="tb-refresh" class="tb-icon-btn" title="Reload from server" aria-label="Reload">
      <i class="bi bi-arrow-clockwise"></i>
    </button>
  `;

  document.getElementById("tb-q").addEventListener("input", (e) => { state.search = e.target.value; state.page = 1; render(); });
  document.getElementById("tb-status").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; saveSettings({ defaultStatus: state.status }); render(); });
  document.getElementById("tb-sort").addEventListener("change", (e) => { state.sort = e.target.value; saveSettings({ defaultSort: state.sort }); render(); });
  document.getElementById("tb-pagesize").addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; saveSettings({ pageSize: state.pageSize }); render(); });
  document.getElementById("tb-refresh").addEventListener("click", () => { load(); toast("Refreshed"); });
};

const contentBlock = (label, text, mode, { error = false } = {}) => {
  if (!text) return "";
  const labelHtml = `<div class="tb-section-label mt-3">${label}</div>`;
  if (mode === "raw") {
    return `${labelHtml}<div class="tb-codeblock ${error ? "tb-codeblock-error" : ""}">${escape(text)}</div>`;
  }
  return `${labelHtml}<div class="tb-prose ${error ? "tb-prose-error" : ""}">${renderMarkdown(text)}</div>`;
};

const renderItem = (t) => {
  const expanded = state.expanded.has(t.id);
  const id = `tb-acc-${t.id}`;
  const mode = modeFor(t.id);
  const pill = `<span class="tb-pill tb-pill-${t.status}"><i class="bi ${statusIcon(t.status)}"></i>${t.status.replace("_", " ")}</span>`;
  const agent = t.agentId ? `<span class="tb-agent-badge"><i class="bi bi-robot"></i>${escape(t.agentId)}</span>` : "";
  const when = `<span class="tb-meta-time" title="${escape(absoluteTime(t.updatedAt || t.createdAt))}">${escape(relativeTime(t.updatedAt || t.createdAt))}</span>`;

  const seg = `
    <div class="tb-seg" role="tablist" aria-label="View mode">
      <button type="button" class="tb-seg-btn ${mode === "rendered" ? "active" : ""}" data-tb-mode="rendered" data-tb-task="${escape(t.id)}">
        <i class="bi bi-eye"></i>Rendered
      </button>
      <button type="button" class="tb-seg-btn ${mode === "raw" ? "active" : ""}" data-tb-mode="raw" data-tb-task="${escape(t.id)}">
        <i class="bi bi-code-slash"></i>Raw
      </button>
    </div>
  `;

  const promptActions = `
    <div class="btn-group btn-group-sm" role="group" aria-label="AI prompt actions">
      <button type="button" class="btn btn-outline-primary" data-tb-copy-prompt="${escape(t.id)}" title="Copy a ready-to-use prompt that tells an AI agent to claim and solve this exact task">
        <i class="bi bi-clipboard me-1"></i>Copy AI prompt
      </button>
      <button type="button" class="btn btn-outline-primary" data-tb-open-prompts="${escape(t.id)}" title="Open the full prompt library (more templates, editable variables)">
        <i class="bi bi-magic"></i>
      </button>
    </div>
  `;

  return `
    <div class="accordion-item" data-id="${escape(t.id)}">
      <h2 class="accordion-header">
        <button class="accordion-button ${expanded ? "" : "collapsed"}" type="button"
                data-bs-toggle="collapse" data-bs-target="#${id}" aria-expanded="${expanded}">
          <div class="tb-task-row">
            ${pill}
            <span class="tb-task-id">#${shortId(t.id)}</span>
            <span class="tb-task-prompt">${escape(t.prompt)}</span>
            <span class="tb-task-meta">${agent}${when}</span>
          </div>
        </button>
      </h2>
      <div id="${id}" class="accordion-collapse collapse ${expanded ? "show" : ""}">
        <div class="accordion-body">
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            ${promptActions}
            ${seg}
          </div>

          ${contentBlock("Prompt", t.prompt, mode)}
          ${contentBlock("Latest progress", t.progress, mode)}
          ${contentBlock("Result", t.result, mode)}
          ${contentBlock("Error", t.error, mode, { error: true })}

          <dl class="tb-timestamps">
            <div><dt>Created</dt><dd title="${escape(absoluteTime(t.createdAt))}">${escape(relativeTime(t.createdAt))}</dd></div>
            <div><dt>Updated</dt><dd title="${escape(absoluteTime(t.updatedAt))}">${escape(relativeTime(t.updatedAt))}</dd></div>
            <div><dt>Claimed</dt><dd title="${escape(absoluteTime(t.claimedAt))}">${t.claimedAt ? escape(relativeTime(t.claimedAt)) : "—"}</dd></div>
            <div><dt>Completed</dt><dd title="${escape(absoluteTime(t.completedAt))}">${t.completedAt ? escape(relativeTime(t.completedAt)) : "—"}</dd></div>
            <div><dt>Full id</dt><dd class="tb-mono">${escape(t.id)}</dd></div>
            <div><dt>Agent</dt><dd>${t.agentId ? escape(t.agentId) : "—"}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  `;
};

const renderList = () => {
  const list = getFiltered();
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pageCount) state.page = pageCount;
  const start = (state.page - 1) * state.pageSize;
  const slice = list.slice(start, start + state.pageSize);

  const container = document.getElementById("tb-list");
  if (total === 0) {
    container.innerHTML = `
      <div class="tb-empty">
        <i class="bi bi-inbox"></i>
        <div>No tasks match your filters.</div>
        <div class="small mt-1">Submit one above, or adjust the search/status.</div>
      </div>`;
  } else {
    container.innerHTML = `<div class="accordion tb-tasks">${slice.map(renderItem).join("")}</div>`;
    // Track expand/collapse so state survives re-renders.
    container.querySelectorAll(".accordion-collapse").forEach((el) => {
      el.addEventListener("shown.bs.collapse", () => state.expanded.add(el.id.replace("tb-acc-", "")));
      el.addEventListener("hidden.bs.collapse", () => state.expanded.delete(el.id.replace("tb-acc-", "")));
    });
    // Wire Rendered/Raw segmented control (delegated — attached once per render).
    container.querySelectorAll("[data-tb-mode]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-task");
        const next = btn.getAttribute("data-tb-mode");
        state.mode.set(id, next);
        // Ensure the accordion stays expanded after re-render.
        state.expanded.add(id);
        renderList();
      });
    });

    // Quick copy: "solve this exact task" prompt with id + preview pre-filled.
    container.querySelectorAll("[data-tb-copy-prompt]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-copy-prompt");
        const task = tasks.get(id);
        if (!task) return;
        const text = buildPrompt("solve-this", {
          TASK_ID: task.id,
          PROMPT_PREVIEW: (task.prompt || "").slice(0, 500),
        });
        const ok = await copyToClipboard(text);
        toast(ok ? "Prompt copied — paste into your AI agent" : "Copy failed — try the prompt library");
      });
    });

    // Open the full prompt library pre-loaded with this task's id/preview.
    container.querySelectorAll("[data-tb-open-prompts]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-open-prompts");
        const task = tasks.get(id);
        openPromptsModal({
          templateId: "solve-this",
          vars: {
            TASK_ID: id,
            PROMPT_PREVIEW: (task?.prompt || "").slice(0, 500),
          },
        });
      });
    });
  }

  const pag = document.getElementById("tb-pagination");
  pag.innerHTML = `
    <span>Showing ${total === 0 ? 0 : start + 1}–${Math.min(start + state.pageSize, total)} of ${total}</span>
    <div class="d-flex align-items-center gap-2">
      <button class="btn btn-outline-secondary" ${state.page <= 1 ? "disabled" : ""} id="tb-prev">
        <i class="bi bi-chevron-left"></i> Prev
      </button>
      <span>Page ${state.page} / ${pageCount}</span>
      <button class="btn btn-outline-secondary" ${state.page >= pageCount ? "disabled" : ""} id="tb-next">
        Next <i class="bi bi-chevron-right"></i>
      </button>
    </div>
  `;
  pag.querySelector("#tb-prev")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderList(); });
  pag.querySelector("#tb-next")?.addEventListener("click", () => { state.page = Math.min(pageCount, state.page + 1); renderList(); });
};

const pendingCount = () => [...tasks.values()].filter((t) => t.status === "pending").length;

const render = () => {
  renderList();
  setPendingCount(pendingCount());
};

const upsert = (t) => {
  if (!t || !t.id) return;
  tasks.set(t.id, t);
  render();
};

const load = async () => {
  try {
    const res = await fetch("/api/tasks");
    const body = await res.json();
    tasks.clear();
    for (const t of body.tasks) tasks.set(t.id, t);
    render();
  } catch (err) {
    toast("Failed to load tasks");
    console.error(err);
  }
};

const setupForm = () => {
  const form = document.getElementById("tb-form");
  const promptEl = document.getElementById("tb-prompt");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = promptEl.value.trim();
    if (!prompt) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "submit failed" }));
        toast(err.error || "submit failed");
        return;
      }
      promptEl.value = "";
      upsert(await res.json());
      toast("Task queued");
    } catch (err) {
      toast("Network error");
      console.error(err);
    }
  });
};

const setupEvents = () => {
  const es = new EventSource("/api/events");
  ["task.created", "task.claimed", "task.progress", "task.completed", "task.failed"].forEach((ev) => {
    es.addEventListener(ev, (e) => {
      try { upsert(JSON.parse(e.data)); } catch {}
    });
  });
};

// Refresh relative timestamps every 30s so "a minute ago" keeps up.
setInterval(() => { if (tasks.size) renderList(); }, 30000);

// Boot
const settings = loadSettings();
state.status = settings.defaultStatus || "all";
state.sort = settings.defaultSort || "newest";
state.pageSize = settings.pageSize || 10;

renderChrome();
renderToolbar();
setupForm();
setupEvents();
load();
