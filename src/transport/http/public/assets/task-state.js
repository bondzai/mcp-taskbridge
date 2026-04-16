/* ============================================================
   Task state store — pure data + derived queries. No DOM access,
   no fetches. All mutations go through the exported methods so
   UI code never touches internals directly.
   ============================================================ */

export const STATUSES = ["all", "pending", "in_progress", "done", "failed"];

export const SORTS = {
  newest:  { label: "Newest first",     cmp: (a, b) => b.createdAt - a.createdAt },
  oldest:  { label: "Oldest first",     cmp: (a, b) => a.createdAt - b.createdAt },
  updated: { label: "Recently updated", cmp: (a, b) => b.updatedAt - a.updatedAt },
  status:  { label: "By status",        cmp: (a, b) => a.status.localeCompare(b.status) || b.createdAt - a.createdAt },
};

export const PAGE_SIZES = [10, 25, 50, 100];

const ANIM_WINDOW_MS = 2000;

export const createTaskStore = () => {
  const tasks = new Map();
  const state = {
    // Filters
    search: "",
    status: "all",
    sort: "newest",
    pageSize: 10,
    page: 1,
    showArchived: false,

    // UI-only state
    expanded: new Set(),
    mode: new Map(),        // taskId → "rendered" | "raw"
    editing: new Set(),
    drafts: new Map(),

    // Animation flags, auto-cleared via markAnim()
    justCreated: new Set(),
    justDone: new Set(),
    justFailed: new Set(),

    // Lifecycle
    loading: true,
  };

  const markAnim = (set, id, ms = ANIM_WINDOW_MS) => {
    set.add(id);
    setTimeout(() => set.delete(id), ms);
  };

  const dropEphemeral = (id) => {
    state.expanded.delete(id);
    state.mode.delete(id);
    state.editing.delete(id);
    state.drafts.delete(id);
    state.justCreated.delete(id);
    state.justDone.delete(id);
    state.justFailed.delete(id);
  };

  return {
    tasks,
    state,
    markAnim,

    get size() { return tasks.size; },

    upsert(task) {
      if (!task || !task.id) return;
      tasks.set(task.id, task);
    },
    remove(id) {
      tasks.delete(id);
      dropEphemeral(id);
    },
    setAll(list) {
      tasks.clear();
      for (const t of list || []) tasks.set(t.id, t);
    },
    get(id) {
      return tasks.get(id);
    },

    modeFor(id) {
      return state.mode.get(id) || "rendered";
    },

    /**
     * Filtered + sorted list respecting the current search / status / sort.
     * Archived tasks are only present if `state.showArchived` is true
     * AND the server was asked to include them (fetch query string).
     */
    filtered() {
      const q = state.search.trim().toLowerCase();
      let list = [...tasks.values()];
      if (state.status !== "all") list = list.filter((t) => t.status === state.status);
      if (q) {
        list = list.filter((t) =>
          t.id.toLowerCase().includes(q) ||
          (t.prompt || "").toLowerCase().includes(q) ||
          (t.agentId || "").toLowerCase().includes(q) ||
          (t.result || "").toLowerCase().includes(q)
        );
      }
      return list.sort(SORTS[state.sort].cmp);
    },

    /** Slice the filtered list for the current page. */
    paged() {
      const list = this.filtered();
      const total = list.length;
      const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pageCount) state.page = pageCount;
      const start = (state.page - 1) * state.pageSize;
      const end = Math.min(start + state.pageSize, total);
      return { list, slice: list.slice(start, end), total, pageCount, start, end };
    },

    pendingCount() {
      let n = 0;
      for (const t of tasks.values()) if (t.status === "pending") n++;
      return n;
    },
  };
};
