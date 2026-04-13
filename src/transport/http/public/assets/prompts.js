/* ============================================================
   Prompt library — composable building blocks instead of giant
   string templates. Every prompt the user can copy is built by
   `compose(sections)` from a small set of named fragments, so
   identical wording (the metadata nudge, the failure rule, the
   tagging note, …) lives in exactly one place.

   Design rules:
   - Fragments are plain strings, no template variables.
   - Templates are pure data + a `sections()` function that
     returns an array of strings.
   - `compose()` joins, trims, and ends with a newline.
   - Variables (TASK_ID, REASON, …) are interpolated by the
     specific template that needs them, never inside fragments.
   ============================================================ */

/* ---------- Reusable fragments ---------- */

const FRAGMENTS = Object.freeze({
  /** Identity statement used at the top of every operational prompt. */
  role: "You are an MCP agent connected to the **taskbridge** connector.",

  /** How the agent badge is decided — applies to every prompt that claims. */
  taggingNote:
    "Taskbridge tags the task with the adapter id from the URL you connected to " +
    "(for example, `/mcp/codex` → tagged `codex`). You do **not** need to pass " +
    "`agent_id` to `claim_task`. Pass it only if you want to override the URL " +
    "tag (e.g. you're a sub-worker spawned by a parent agent).",

  /** Result-formatting expectations for `submit_result`. */
  resultFormat: [
    "- Lead with the answer, not the process.",
    "- Use headings, lists, and tables where they add clarity.",
    "- Cite sources as Markdown links when you looked something up.",
  ].join("\n"),

  /** Optional metadata the agent should pass on submit_result. */
  metadataNudge:
    "**If your runtime exposes them**, also pass these optional arguments to " +
    "`submit_result`: `model` (e.g. `\"claude-opus-4-6\"`, `\"gpt-5\"`, " +
    "`\"codex-1\"`), `tokens_in`, `tokens_out`, `total_tokens`. " +
    "Taskbridge displays them on the dashboard.",

  /** What to do when the task can't be completed. */
  failureRule:
    "If you cannot complete the task — ambiguous, unsafe, out of scope, " +
    "or missing context — call `fail_task` with the id and a short reason " +
    "(≤ 2 sentences). Do **not** guess.",

  /** The "stay in your lane" rule. */
  stateOnlyRule:
    "Use taskbridge tools ONLY for state transitions " +
    "(`claim_task` / `report_progress` / `submit_result` / `fail_task`). " +
    "Do the actual work with whatever other tools you have " +
    "(web search, code execution, file tools, reasoning).",
});

/* ---------- Composer ---------- */

const compose = (sections) =>
  sections
    .filter((s) => s != null && String(s).trim() !== "")
    .map((s) => String(s).trim())
    .join("\n\n")
    .trim() + "\n";

/* ---------- Template definitions ---------- */

const tplSolveOldest = () => compose([
  `${FRAGMENTS.role} Pick up and complete ONE task from the pending queue.`,

  "## Steps",
  [
    "1. Call `list_pending_tasks`. If the list is empty, reply \"No pending tasks.\" and stop.",
    "2. Pick the **oldest** task (smallest `createdAt`).",
    "3. Call `claim_task` with that task's `id`.",
    "4. Read the task's `prompt` field carefully and do the work.",
    "5. (Optional) Call `report_progress` with short status updates as you work — keep each under 200 characters.",
    "6. Call `submit_result` with the `id` and a **well-formatted Markdown** result.",
    "7. " + FRAGMENTS.failureRule,
  ].join("\n"),

  "## Tagging",
  FRAGMENTS.taggingNote,

  "## Result format",
  FRAGMENTS.resultFormat,
  FRAGMENTS.metadataNudge,

  "## Rules",
  [
    "- " + FRAGMENTS.stateOnlyRule,
    "- Do **not** claim more than one task in this run.",
    "- Do **not** modify tasks you did not claim.",
  ].join("\n"),
]);

const tplSolveThis = ({ TASK_ID, PROMPT_PREVIEW }) => {
  const id = String(TASK_ID || "").trim();
  const preview = String(PROMPT_PREVIEW || "").trim();
  return compose([
    `${FRAGMENTS.role} You must handle one specific task.`,

    "## Target",
    `Task id: \`${id}\``,

    "## Steps",
    [
      `1. Call \`get_task\` with id \`${id}\`. If its status is not \`pending\`, stop and report what the status is — do not try to claim an already-claimed task.`,
      `2. Call \`claim_task\` with id \`${id}\`.`,
      `3. Complete the work described in the task's \`prompt\` field. Interpret it charitably if ambiguous, but be explicit about your interpretation in the result.`,
      `4. (Optional) Call \`report_progress\` with id \`${id}\` and a short status update while you work.`,
      `5. Call \`submit_result\` with id \`${id}\` and a **well-formatted Markdown** answer.`,
      "6. " + FRAGMENTS.failureRule,
    ].join("\n"),

    "## Tagging",
    FRAGMENTS.taggingNote,

    "## Result format",
    FRAGMENTS.resultFormat,
    FRAGMENTS.metadataNudge,

    "## Rules",
    [
      `- Only touch task \`${id}\`. Do not claim, modify, or submit any other task.`,
      "- " + FRAGMENTS.stateOnlyRule,
    ].join("\n"),

    preview ? `## Prompt preview (for context — \`get_task\` is authoritative)\n\n> ${preview.split("\n").join("\n> ")}` : null,
  ]);
};

const tplTriage = () => compose([
  "You are a triage assistant connected to the **taskbridge** connector. Your job is to **categorise**, not to execute.",

  "## Steps",
  [
    "1. Call `list_pending_tasks` to get every currently-pending task.",
    "2. For each task, infer:",
    "   - **type** — one of: research, summarise, code, data lookup, creative, other",
    "   - **difficulty** — one of: trivial, moderate, hard",
    "   - **one-line summary** — ≤ 80 characters, plain English",
    "3. Return a single Markdown table with columns: `id (short) | type | difficulty | summary`.",
    "   Use the first 8 characters of each task's `id` as the short id.",
  ].join("\n"),

  "## Hard rules",
  [
    "- Do **not** call `claim_task`, `submit_result`, `fail_task`, or `report_progress`.",
    "- This is a read-only pass. If the queue is empty, say so and stop.",
  ].join("\n"),
]);

const tplFailWithReason = ({ TASK_ID, REASON }) => {
  const id = String(TASK_ID || "").trim();
  const reason = String(REASON || "").trim();
  return compose([
    `${FRAGMENTS.role} Mark the task below as failed and stop.`,

    "## Steps",
    [
      `1. Call \`fail_task\` with \`id\`: \`${id}\` and \`reason\`: the exact text below, verbatim.`,
      "2. Do **not** claim, submit, or touch any other task.",
      "3. After the tool call succeeds, reply with a single sentence confirming the failure.",
    ].join("\n"),

    "## Reason to pass to `fail_task`",
    reason || "_(fill in the reason in the variables panel)_",
  ]);
};

/* ---------- Public template registry ---------- */

export const PROMPT_TEMPLATES = [
  {
    id: "solve-oldest",
    name: "Solve oldest pending task",
    description: "Claim the single oldest pending task and complete it end-to-end. Identity-neutral — agent labelling comes from your /mcp/<adapter> URL.",
    icon: "bi-play-circle",
    variables: [],
    build: tplSolveOldest,
  },
  {
    id: "solve-this",
    name: "Solve this specific task",
    description: "Claim a task by id and complete it. The id is pre-filled from the current task. Identity comes from your /mcp/<adapter> URL.",
    icon: "bi-bullseye",
    variables: [
      { key: "TASK_ID", label: "Task id", placeholder: "e.g. 423b0b0d-...", required: true },
      { key: "PROMPT_PREVIEW", label: "Prompt preview (optional)", placeholder: "pasted from the task card", required: false, textarea: true },
    ],
    build: tplSolveThis,
  },
  {
    id: "triage",
    name: "Triage the pending queue (read-only)",
    description: "Categorise every pending task without claiming any — useful for planning.",
    icon: "bi-clipboard-data",
    variables: [],
    build: tplTriage,
  },
  {
    id: "fail-with-reason",
    name: "Fail a task with a reason",
    description: "Mark a specific task as failed. Use when a task is unsafe, duplicate, or out of scope.",
    icon: "bi-x-octagon",
    variables: [
      { key: "TASK_ID", label: "Task id", placeholder: "e.g. 423b0b0d-...", required: true },
      { key: "REASON",  label: "Reason",  placeholder: "Why this task should be rejected", required: true, textarea: true },
    ],
    build: tplFailWithReason,
  },
];

/* Exported for tests so reusable fragments are inspectable. */
export const PROMPT_FRAGMENTS = FRAGMENTS;

export const getTemplate = (id) => PROMPT_TEMPLATES.find((t) => t.id === id);

export const buildPrompt = (id, vars = {}) => {
  const tpl = getTemplate(id);
  if (!tpl) throw new Error(`unknown prompt template: ${id}`);
  return tpl.build(vars);
};

/* ---------- Clipboard helper (modern API + textarea fallback) ---------- */

export const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};
