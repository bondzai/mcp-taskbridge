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
  role: "You are an MCP agent connected to the **procurement-agent** connector.",

  /** How the agent badge is decided — applies to every prompt that claims. */
  taggingNote:
    "Procurement Agent tags the task with the adapter id from the URL you connected to" +
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
    "Procurement Agent displays them on the dashboard.",

  /** What to do when the task can't be completed. */
  failureRule:
    "If you cannot complete the task — ambiguous, unsafe, out of scope, " +
    "or missing context — call `fail_task` with the id and a short reason " +
    "(≤ 2 sentences). Do **not** guess.",

  /** The "stay in your lane" rule. */
  stateOnlyRule:
    "Use procurement-agent tools ONLY for state transitions " +
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

const tplSourceOldest = () => compose([
  `${FRAGMENTS.role} Pick up and complete ONE sourcing task from the queue.`,

  "## Steps",
  [
    "1. Call `list_pending_tasks`. If empty, reply \"No pending tasks.\" and stop.",
    "2. Pick the **oldest** task (smallest `createdAt`).",
    "3. Call `claim_task` with that task's `id`.",
    "4. Read the `prompt` — it references a Purchase Request (PR) with items to source.",
    "5. Call `get_purchase_request` with the PR id from the prompt to see all line items.",
    "6. For each item, call `search_vendors` with the material name to find matching suppliers.",
    "7. Call `get_vendor_details` to verify capabilities and check `get_purchase_history` for past pricing.",
    "8. Call `report_progress` after each vendor search — the user watches live.",
    "9. Call `submit_vendor_shortlist` with the PR id and your recommended vendor-item mappings.",
    "10. Call `submit_result` with a Markdown summary of your findings.",
    "11. " + FRAGMENTS.failureRule,
  ].join("\n"),

  "## Available procurement tools",
  [
    "- `search_vendors(material_name, category?)` — find vendors for a material",
    "- `get_vendor_details(vendor_id)` — full vendor profile + materials",
    "- `get_purchase_request(pr_id)` — PR with all line items",
    "- `get_purchase_history(material_name?, vendor_id?)` — past completed purchases",
    "- `submit_vendor_shortlist(pr_id, shortlist[])` — submit sourcing results",
    "- `update_item_status(pr_id, item_id, status, note?)` — update individual item status",
  ].join("\n"),

  "## Result format",
  FRAGMENTS.resultFormat,
  FRAGMENTS.metadataNudge,

  "## Rules",
  [
    "- Find at least 2 vendors per item when possible for competitive quotes.",
    "- Include reference prices from `search_vendors` in the shortlist.",
    "- Do **not** claim more than one task in this run.",
  ].join("\n"),
]);

const tplSourcePr = ({ PR_ID }) => {
  const id = String(PR_ID || "").trim();
  return compose([
    `${FRAGMENTS.role} Source vendors for a specific Purchase Request.`,

    "## Target",
    `PR id: \`${id}\``,

    "## Steps",
    [
      `1. Call \`list_pending_tasks\` and find the sourcing task for PR \`${id}\`.`,
      "2. Call `claim_task` with the task id.",
      `3. Call \`get_purchase_request\` with PR id \`${id}\` to see all line items.`,
      "4. For each line item, call `search_vendors` with the material name.",
      "5. Call `get_vendor_details` for promising matches and `get_purchase_history` for pricing context.",
      "6. Call `report_progress` after each vendor search.",
      `7. Call \`submit_vendor_shortlist\` with PR id \`${id}\` and your recommendations.`,
      "8. Call `submit_result` with a Markdown summary.",
      "9. " + FRAGMENTS.failureRule,
    ].join("\n"),

    "## Rules",
    [
      "- Find at least 2 vendors per item when possible.",
      "- Include reference prices in the shortlist.",
      `- Only work on PR \`${id}\`.`,
    ].join("\n"),

    FRAGMENTS.metadataNudge,
  ]);
};

const tplTriage = () => compose([
  `${FRAGMENTS.role} Review and categorise all pending sourcing tasks without claiming any.`,

  "## Steps",
  [
    "1. Call `list_pending_tasks` to get the queue.",
    "2. For each task, call `get_purchase_request` with the PR id to see the items.",
    "3. Categorise each PR by:",
    "   - **urgency** — check deadline vs today",
    "   - **complexity** — number of items, specialty materials",
    "   - **estimated value** — rough total from reference prices",
    "4. Return a Markdown table: `PR (short id) | Title | Items | Urgency | Complexity | Est. Value`.",
  ].join("\n"),

  "## Hard rules",
  [
    "- Do **not** call `claim_task`, `submit_result`, `fail_task`, or `report_progress`.",
    "- This is a read-only assessment. If the queue is empty, say so and stop.",
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
      "3. After the tool call succeeds, reply confirming the failure.",
    ].join("\n"),

    "## Reason to pass to `fail_task`",
    reason || "_(fill in the reason in the variables panel)_",
  ]);
};

/* ---------- Public template registry ---------- */

export const PROMPT_TEMPLATES = [
  {
    id: "source-oldest",
    name: "Source oldest pending PR",
    description: "Claim the oldest sourcing task, find vendors for all items, and submit a shortlist.",
    icon: "bi-search",
    variables: [],
    build: tplSourceOldest,
  },
  {
    id: "source-pr",
    name: "Source a specific PR",
    description: "Find vendors for a specific Purchase Request by id.",
    icon: "bi-bullseye",
    variables: [
      { key: "PR_ID", label: "PR id", placeholder: "e.g. 64cdd836-...", required: true },
    ],
    build: tplSourcePr,
  },
  {
    id: "triage",
    name: "Triage pending queue (read-only)",
    description: "Assess all pending sourcing tasks — urgency, complexity, estimated value — without claiming any.",
    icon: "bi-clipboard-data",
    variables: [],
    build: tplTriage,
  },
  {
    id: "fail-with-reason",
    name: "Fail a task with a reason",
    description: "Mark a sourcing task as failed when it can't be completed.",
    icon: "bi-x-octagon",
    variables: [
      { key: "TASK_ID", label: "Task id", placeholder: "e.g. 423b0b0d-...", required: true },
      { key: "REASON",  label: "Reason",  placeholder: "Why this task cannot be completed", required: true, textarea: true },
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
