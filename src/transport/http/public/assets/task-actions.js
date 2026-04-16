/* ============================================================
   Task action handlers — API client + DOM event dispatch.
   ============================================================ */

import { toast, openPromptsModal } from "./chrome.js";
import { buildPrompt, copyToClipboard } from "./prompts.js";

/* ---------- API client ---------- */

const json = (url, init = {}) =>
  fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
    return body;
  });

export const taskApi = {
  list:      (includeArchived) =>
    json(includeArchived ? "/api/tasks?include_archived=true" : "/api/tasks"),
  create:    (prompt) => json("/api/tasks", { method: "POST", body: JSON.stringify({ prompt }) }),
  update:    (id, prompt) => json(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ prompt }) }),
  remove:    (id) => json(`/api/tasks/${id}`, { method: "DELETE" }),
  archive:   (id) => json(`/api/tasks/${id}/archive`, { method: "POST" }),
  unarchive: (id) => json(`/api/tasks/${id}/unarchive`, { method: "POST" }),
};

/* ---------- Initial task load ---------- */

export const loadTasks = async (store, { onChange, announce = true } = {}) => {
  try {
    store.state.loading = true;
    onChange();
    const body = await taskApi.list(store.state.showArchived);
    store.setAll(body.tasks || []);
    store.state.loading = false;
    onChange();
    if (announce) toast(`Loaded ${body.tasks?.length ?? 0} tasks`);
  } catch (err) {
    store.state.loading = false;
    onChange();
    toast("Failed to load tasks");
    console.error(err);
  }
};

/* ---------- Fade-out helper ---------- */

export const animateRemove = (id, store, onChange) => {
  const node = document.querySelector(`.accordion-item[data-id="${CSS.escape(id)}"]`);
  const finalise = () => {
    store.remove(id);
    onChange();
  };
  if (!node) { finalise(); return; }
  node.classList.add("tb-task-fading");
  setTimeout(finalise, 320);
};

/* ---------- Delegated click dispatch ---------- */

const handlers = {
  async "copy-prompt"({ id, store }) {
    const task = store.get(id);
    if (!task) return;
    const text = buildPrompt("solve-this", {
      TASK_ID: task.id,
      PROMPT_PREVIEW: (task.prompt || "").slice(0, 500),
    });
    const ok = await copyToClipboard(text);
    toast(ok ? "Prompt copied — paste into your AI agent" : "Copy failed — try the prompt library");
  },

  async "open-prompts"({ id, store }) {
    const task = store.get(id);
    openPromptsModal({
      templateId: "solve-this",
      vars: { TASK_ID: id, PROMPT_PREVIEW: (task?.prompt || "").slice(0, 500) },
    });
  },

  async "set-mode"({ id, target, store, onChange }) {
    const next = target.getAttribute("data-mode");
    store.state.mode.set(id, next);
    store.state.expanded.add(id); // keep accordion open across re-render
    onChange();
  },

  async "edit"({ id, store, onChange }) {
    store.state.editing.add(id);
    store.state.expanded.add(id);
    store.state.drafts.set(id, store.get(id)?.prompt ?? "");
    onChange();
  },

  async "cancel-edit"({ id, store, onChange }) {
    store.state.editing.delete(id);
    store.state.drafts.delete(id);
    onChange();
  },

  async "save-edit"({ id, store, onChange }) {
    const newPrompt = (store.state.drafts.get(id) ?? "").trim();
    if (!newPrompt) { toast("Prompt cannot be empty"); return; }
    try {
      const updated = await taskApi.update(id, newPrompt);
      store.state.editing.delete(id);
      store.state.drafts.delete(id);
      store.upsert(updated);
      onChange();
      toast("Prompt updated");
    } catch (err) {
      toast(err.message || "Update failed");
    }
  },

  async archive({ id, store, onChange }) {
    try {
      const updated = await taskApi.archive(id);
      if (store.state.showArchived) {
        store.upsert(updated);
        onChange();
      } else {
        animateRemove(id, store, onChange);
      }
      toast("Task archived");
    } catch (err) {
      toast(err.message || "Archive failed");
    }
  },

  async unarchive({ id, store, onChange }) {
    try {
      const updated = await taskApi.unarchive(id);
      store.upsert(updated);
      onChange();
      toast("Task unarchived");
    } catch (err) {
      toast(err.message || "Unarchive failed");
    }
  },

  async delete({ id, store, onChange }) {
    if (!confirm("Permanently delete this task? This cannot be undone.")) return;
    try {
      await taskApi.remove(id);
      animateRemove(id, store, onChange);
      toast("Task deleted");
    } catch (err) {
      toast(err.message || "Delete failed");
    }
  },
};

/* ---------- Input-level delegation (drafts) ---------- */

const inputHandlers = {
  "edit-input"({ id, target, store }) {
    store.state.drafts.set(id, target.value);
  },
};

/* ---------- Public wiring ---------- */

export const bindListDelegation = (store, onChange) => {
  const list = document.getElementById("tb-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target || !list.contains(target)) return;
    const action = target.getAttribute("data-action");
    const handler = handlers[action];
    if (!handler) return;
    e.preventDefault();
    e.stopPropagation();
    const id = target.getAttribute("data-id");
    handler({ id, target, store, onChange }).catch((err) => {
      console.error(`[tb] action "${action}" failed:`, err);
      toast("Action failed — see console");
    });
  }, { passive: false });

  list.addEventListener("input", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    const handler = inputHandlers[action];
    if (handler) {
      const id = target.getAttribute("data-id");
      handler({ id, target, store });
    }
  });
};

/* ---------- Pagination (separate container) ---------- */

export const bindPaginationDelegation = (store, onChange) => {
  const pag = document.getElementById("tb-pagination");
  if (!pag) return;
  pag.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "page-prev") { store.state.page = Math.max(1, store.state.page - 1); onChange(); }
    if (action === "page-next") { store.state.page = store.state.page + 1; onChange(); }
  });
};

/* ---------- Toolbar wiring ---------- */

export const bindToolbar = (store, { onChange, onReload, saveSettings }) => {
  const bind = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };
  bind("tb-q", "input", (e) => { store.state.search = e.target.value; store.state.page = 1; onChange(); });
  bind("tb-status", "change", (e) => { store.state.status = e.target.value; store.state.page = 1; saveSettings({ defaultStatus: store.state.status }); onChange(); });
  bind("tb-sort", "change", (e) => { store.state.sort = e.target.value; saveSettings({ defaultSort: store.state.sort }); onChange(); });
  bind("tb-pagesize", "change", (e) => { store.state.pageSize = Number(e.target.value); store.state.page = 1; saveSettings({ pageSize: store.state.pageSize }); onChange(); });
  bind("tb-show-archived", "change", (e) => { store.state.showArchived = e.target.checked; store.state.page = 1; onReload(); });
  bind("tb-refresh", "click", () => onReload());
};

/* ---------- Submit form ---------- */

export const bindSubmitForm = (store, onChange) => {
  const form = document.getElementById("tb-form");
  const promptEl = document.getElementById("tb-prompt");
  if (!form || !promptEl) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = promptEl.value.trim();
    if (!prompt) return;
    try {
      const created = await taskApi.create(prompt);
      promptEl.value = "";
      store.upsert(created);
      onChange();
      toast("Task queued");
    } catch (err) {
      toast(err.message || "Submit failed");
    }
  });
};

/* ---------- SSE event subscriptions ---------- */

export const bindSse = (store, onChange) => {
  const es = new EventSource("/api/events");

  for (const ev of ["task.claimed", "task.progress", "task.updated", "task.unarchived"]) {
    es.addEventListener(ev, (e) => {
      try { store.upsert(JSON.parse(e.data)); onChange(); } catch {}
    });
  }

  const onAnim = (ev, set) => es.addEventListener(ev, (e) => {
    try { const t = JSON.parse(e.data); store.markAnim(set, t.id); store.upsert(t); onChange(); } catch {}
  });
  onAnim("task.created", store.state.justCreated);
  onAnim("task.completed", store.state.justDone);
  onAnim("task.failed", store.state.justFailed);

  es.addEventListener("task.archived", (e) => {
    try {
      const t = JSON.parse(e.data);
      if (store.state.showArchived) {
        store.upsert(t);
        onChange();
      } else {
        animateRemove(t.id, store, onChange);
      }
    } catch {}
  });

  es.addEventListener("task.deleted", (e) => {
    try { animateRemove(JSON.parse(e.data).id, store, onChange); } catch {}
  });
};
