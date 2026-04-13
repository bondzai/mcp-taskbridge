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
  mode: new Map(),       // taskId → "rendered" | "raw"
  editing: new Set(),    // taskId → currently in edit mode
  drafts: new Map(),     // taskId → in-progress edit text
  showArchived: false,
};

const modeFor = (id) => state.mode.get(id) || "rendered";

const formatDuration = (ms) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s}s`;
};

const formatNumber = (n) => {
  if (n == null) return "—";
  return new Intl.NumberFormat().format(n);
};

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
    <div class="form-check form-switch m-0 ms-1" title="Show archived tasks">
      <input class="form-check-input" type="checkbox" id="tb-show-archived" ${state.showArchived ? "checked" : ""}>
      <label class="form-check-label small text-body-secondary" for="tb-show-archived">Archived</label>
    </div>
    <button id="tb-refresh" class="tb-icon-btn" title="Reload from server" aria-label="Reload">
      <i class="bi bi-arrow-clockwise"></i>
    </button>
  `;

  document.getElementById("tb-q").addEventListener("input", (e) => { state.search = e.target.value; state.page = 1; render(); });
  document.getElementById("tb-status").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; saveSettings({ defaultStatus: state.status }); render(); });
  document.getElementById("tb-sort").addEventListener("change", (e) => { state.sort = e.target.value; saveSettings({ defaultSort: state.sort }); render(); });
  document.getElementById("tb-pagesize").addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; saveSettings({ pageSize: state.pageSize }); render(); });
  document.getElementById("tb-show-archived").addEventListener("change", (e) => { state.showArchived = e.target.checked; state.page = 1; load(); });
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

const runDetails = (t) => {
  const wait = t.claimedAt && t.createdAt ? t.claimedAt - t.createdAt : null;
  const work = t.completedAt && t.claimedAt ? t.completedAt - t.claimedAt : null;
  const total = t.completedAt && t.createdAt ? t.completedAt - t.createdAt : null;
  const hasTokens = t.totalTokens != null || t.tokensIn != null || t.tokensOut != null;
  const hasModel = t.model != null;
  const hasTiming = wait != null || work != null || total != null;

  if (!hasTokens && !hasModel && !hasTiming) return "";

  const rows = [];
  if (hasModel) rows.push(`<div><dt>Model</dt><dd class="tb-mono">${escape(t.model)}</dd></div>`);
  if (work != null) rows.push(`<div><dt>Time working</dt><dd>${escape(formatDuration(work))}</dd></div>`);
  if (wait != null) rows.push(`<div><dt>Time waiting</dt><dd>${escape(formatDuration(wait))}</dd></div>`);
  if (total != null) rows.push(`<div><dt>Total elapsed</dt><dd>${escape(formatDuration(total))}</dd></div>`);
  if (t.tokensIn != null) rows.push(`<div><dt>Tokens in</dt><dd>${escape(formatNumber(t.tokensIn))}</dd></div>`);
  if (t.tokensOut != null) rows.push(`<div><dt>Tokens out</dt><dd>${escape(formatNumber(t.tokensOut))}</dd></div>`);
  if (t.totalTokens != null) rows.push(`<div><dt>Total tokens</dt><dd>${escape(formatNumber(t.totalTokens))}</dd></div>`);

  return `
    <div class="tb-section-label mt-3">Run details</div>
    <dl class="tb-timestamps tb-run-details">${rows.join("")}</dl>
  `;
};

const renderItem = (t) => {
  const expanded = state.expanded.has(t.id);
  const id = `tb-acc-${t.id}`;
  const mode = modeFor(t.id);
  const isArchived = t.archivedAt != null;
  const isEditing = state.editing.has(t.id);
  const canEdit = t.status === "pending" && !isArchived;
  const pill = `<span class="tb-pill tb-pill-${t.status}"><i class="bi ${statusIcon(t.status)}"></i>${t.status.replace("_", " ")}</span>`;
  const archivedPill = isArchived ? `<span class="tb-pill tb-pill-archived"><i class="bi bi-archive"></i>archived</span>` : "";
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

  const taskActions = `
    <div class="btn-group btn-group-sm" role="group" aria-label="Task actions">
      ${canEdit ? `<button type="button" class="btn btn-outline-secondary" data-tb-edit="${escape(t.id)}" title="Edit prompt (only available while pending)">
        <i class="bi bi-pencil"></i>
      </button>` : ""}
      ${isArchived
        ? `<button type="button" class="btn btn-outline-secondary" data-tb-unarchive="${escape(t.id)}" title="Unarchive">
            <i class="bi bi-archive-fill"></i>
          </button>`
        : `<button type="button" class="btn btn-outline-secondary" data-tb-archive="${escape(t.id)}" title="Archive — hides from default list, reversible">
            <i class="bi bi-archive"></i>
          </button>`}
      <button type="button" class="btn btn-outline-danger" data-tb-delete="${escape(t.id)}" title="Delete permanently">
        <i class="bi bi-trash"></i>
      </button>
    </div>
  `;

  const promptOrEditor = isEditing
    ? `
      <div class="tb-section-label mt-3">Prompt (editing)</div>
      <textarea class="form-control tb-edit-textarea" data-tb-draft="${escape(t.id)}" rows="4">${escape(state.drafts.get(t.id) ?? t.prompt)}</textarea>
      <div class="d-flex gap-2 mt-2">
        <button type="button" class="btn btn-primary btn-sm" data-tb-save-edit="${escape(t.id)}">
          <i class="bi bi-check2 me-1"></i>Save
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-tb-cancel-edit="${escape(t.id)}">
          Cancel
        </button>
      </div>
    `
    : contentBlock("Prompt", t.prompt, mode);

  return `
    <div class="accordion-item ${isArchived ? "tb-task-archived" : ""}" data-id="${escape(t.id)}">
      <h2 class="accordion-header">
        <button class="accordion-button ${expanded ? "" : "collapsed"}" type="button"
                data-bs-toggle="collapse" data-bs-target="#${id}" aria-expanded="${expanded}">
          <div class="tb-task-row">
            ${pill}
            ${archivedPill}
            <span class="tb-task-id">#${shortId(t.id)}</span>
            <span class="tb-task-prompt">${escape(t.prompt)}</span>
            <span class="tb-task-meta">${agent}${when}</span>
          </div>
        </button>
      </h2>
      <div id="${id}" class="accordion-collapse collapse ${expanded ? "show" : ""}">
        <div class="accordion-body">
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div class="d-flex gap-2 flex-wrap">
              ${promptActions}
              ${taskActions}
            </div>
            ${seg}
          </div>

          ${promptOrEditor}
          ${contentBlock("Latest progress", t.progress, mode)}
          ${contentBlock("Result", t.result, mode)}
          ${contentBlock("Error", t.error, mode, { error: true })}

          ${runDetails(t)}

          <dl class="tb-timestamps">
            <div><dt>Created</dt><dd title="${escape(absoluteTime(t.createdAt))}">${escape(relativeTime(t.createdAt))}</dd></div>
            <div><dt>Updated</dt><dd title="${escape(absoluteTime(t.updatedAt))}">${escape(relativeTime(t.updatedAt))}</dd></div>
            <div><dt>Claimed</dt><dd title="${escape(absoluteTime(t.claimedAt))}">${t.claimedAt ? escape(relativeTime(t.claimedAt)) : "—"}</dd></div>
            <div><dt>Completed</dt><dd title="${escape(absoluteTime(t.completedAt))}">${t.completedAt ? escape(relativeTime(t.completedAt)) : "—"}</dd></div>
            ${isArchived ? `<div><dt>Archived</dt><dd title="${escape(absoluteTime(t.archivedAt))}">${escape(relativeTime(t.archivedAt))}</dd></div>` : ""}
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

    // ---- Edit / Archive / Delete actions -------------------------------

    container.querySelectorAll("[data-tb-edit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-edit");
        state.editing.add(id);
        state.expanded.add(id);
        state.drafts.set(id, tasks.get(id)?.prompt ?? "");
        renderList();
      });
    });

    container.querySelectorAll("[data-tb-cancel-edit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-cancel-edit");
        state.editing.delete(id);
        state.drafts.delete(id);
        renderList();
      });
    });

    container.querySelectorAll("[data-tb-draft]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const id = el.getAttribute("data-tb-draft");
        state.drafts.set(id, e.target.value);
      });
    });

    container.querySelectorAll("[data-tb-save-edit]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-save-edit");
        const newPrompt = (state.drafts.get(id) ?? "").trim();
        if (!newPrompt) {
          toast("Prompt cannot be empty");
          return;
        }
        try {
          const res = await fetch(`/api/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: newPrompt }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "update failed" }));
            toast(err.error || "update failed");
            return;
          }
          const updated = await res.json();
          state.editing.delete(id);
          state.drafts.delete(id);
          upsert(updated);
          toast("Prompt updated");
        } catch (err) {
          toast("Network error");
          console.error(err);
        }
      });
    });

    container.querySelectorAll("[data-tb-archive]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-archive");
        try {
          const res = await fetch(`/api/tasks/${id}/archive`, { method: "POST" });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "archive failed" }));
            toast(err.error || "archive failed");
            return;
          }
          const updated = await res.json();
          if (state.showArchived) {
            upsert(updated);
          } else {
            tasks.delete(id);
            render();
          }
          toast("Task archived");
        } catch (err) {
          toast("Network error");
          console.error(err);
        }
      });
    });

    container.querySelectorAll("[data-tb-unarchive]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-unarchive");
        try {
          const res = await fetch(`/api/tasks/${id}/unarchive`, { method: "POST" });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "unarchive failed" }));
            toast(err.error || "unarchive failed");
            return;
          }
          const updated = await res.json();
          upsert(updated);
          toast("Task unarchived");
        } catch (err) {
          toast("Network error");
          console.error(err);
        }
      });
    });

    container.querySelectorAll("[data-tb-delete]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-tb-delete");
        if (!confirm("Permanently delete this task? This cannot be undone.")) return;
        try {
          const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "delete failed" }));
            toast(err.error || "delete failed");
            return;
          }
          tasks.delete(id);
          state.editing.delete(id);
          state.drafts.delete(id);
          state.expanded.delete(id);
          render();
          toast("Task deleted");
        } catch (err) {
          toast("Network error");
          console.error(err);
        }
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
    const url = state.showArchived ? "/api/tasks?include_archived=true" : "/api/tasks";
    const res = await fetch(url);
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
  const upsertEvents = [
    "task.created", "task.claimed", "task.progress",
    "task.completed", "task.failed", "task.updated", "task.unarchived",
  ];
  for (const ev of upsertEvents) {
    es.addEventListener(ev, (e) => {
      try { upsert(JSON.parse(e.data)); } catch {}
    });
  }
  es.addEventListener("task.archived", (e) => {
    try {
      const t = JSON.parse(e.data);
      if (state.showArchived) {
        upsert(t);
      } else {
        tasks.delete(t.id);
        render();
      }
    } catch {}
  });
  es.addEventListener("task.deleted", (e) => {
    try {
      const t = JSON.parse(e.data);
      tasks.delete(t.id);
      state.editing.delete(t.id);
      state.drafts.delete(t.id);
      state.expanded.delete(t.id);
      render();
    } catch {}
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
