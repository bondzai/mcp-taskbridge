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
    "2. Pick the **oldest** task. Call `claim_task` with its id.",
    "3. Call `get_purchase_request` with the PR id from the prompt — read the line items.",
    "",
    "**Phase 1 — Internal vendors (our database):**",
    "4. For each item, call `search_vendors(material_name)`. Note vendor ids and reference prices.",
    "5. Optionally call `get_vendor_details` and `get_purchase_history` for context.",
    "6. Call `report_progress` after each search.",
    "",
    "**Phase 2 — External market research (web):**",
    "7. Use web search to find 3–5 reputable external vendors per item (or item category).",
    "8. For each external vendor, you MUST collect: **name, contact email, country/address, estimated price, lead time**. The email is REQUIRED — without it the system can't send an RFQ.",
    "9. Call `report_progress` with what you found.",
    "",
    "**Phase 3 — Submit the shortlist (this is the critical step):**",
    "10. Call `submit_vendor_shortlist(pr_id, shortlist)` with BOTH internal AND external vendors in the SAME array.",
    "    - For internal vendors: pass `vendorId` (from `search_vendors` results)",
    "    - For external vendors: pass a `vendor` object — the system will auto-create the record AND email them.",
    "    - **DO NOT just list external vendors in your result text — they MUST be in this tool call to actually be contacted.**",
    "11. Call `submit_result` with a Markdown comparison report.",
    "12. " + FRAGMENTS.failureRule,
  ].join("\n"),

  "## CRITICAL — submit_vendor_shortlist payload format",
  [
    "Each entry must have EITHER `vendorId` (existing) OR `vendor` (new external).",
    "Mix them freely in the same call. Example:",
    "",
    "```json",
    "{",
    "  \"pr_id\": \"abc-123\",",
    "  \"shortlist\": [",
    "    {",
    "      \"vendorId\": \"859b2fd9-...\",         // internal — found via search_vendors",
    "      \"lineItemId\": 5,",
    "      \"referencePrice\": 3.20,",
    "      \"notes\": \"Existing supplier, fast lead time\"",
    "    },",
    "    {",
    "      \"vendor\": {                            // external — found via web search",
    "        \"name\": \"Huadong Cable Group\",",
    "        \"email\": \"sales@huadongcable.com\",  // REQUIRED — RFQ sent here",
    "        \"address\": \"Hangzhou, China\",",
    "        \"categories\": [\"electrical\", \"cable\"],",
    "        \"leadTimeDays\": 30,",
    "        \"currency\": \"USD\",",
    "        \"notes\": \"Found via Google. Strong on bulk copper cable. https://huadongcable.com\"",
    "      },",
    "      \"lineItemId\": 5,",
    "      \"referencePrice\": 2.80,",
    "      \"notes\": \"Cheaper alternative, longer lead time\"",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "**HARD CONSEQUENCE — read this carefully:**",
    "The decision engine requires that EVERY line item have at least one vendor in the call. " +
    "If even ONE line item has zero vendors in `shortlist`, the entire batch is rejected " +
    "and **ZERO RFx emails are sent** — including for items that DID have vendors. " +
    "So if our internal database lacks coverage for an item, you MUST include externals via " +
    "the `vendor` object — listing them only in your `submit_result` markdown report sends nothing.",
    "",
    "If you can't find a real email for an external vendor, skip that vendor — but you still need " +
    "at least one vendor (internal or external with email) per line item, otherwise the batch dies.",
  ].join("\n"),

  "## Tools",
  [
    "- `search_vendors(material_name, category?)` — internal database",
    "- `get_vendor_details(vendor_id)` — vendor profile",
    "- `get_purchase_request(pr_id)` — PR with line items",
    "- `get_purchase_history(material_name?, vendor_id?)` — past purchases",
    "- `submit_vendor_shortlist(pr_id, shortlist[])` — submit BOTH internal + external",
    "- `update_item_status(pr_id, item_id, status, note?)` — per-item status",
    "- Web search — your built-in tool for finding external vendors",
  ].join("\n"),

  FRAGMENTS.metadataNudge,

  "## Rules",
  [
    "- 2+ internal vendors per item when possible.",
    "- 3–5 external vendors per item, with valid email addresses.",
    "- Every vendor (internal or external) goes in `submit_vendor_shortlist` — that's how RFQ emails are triggered.",
    "- Do **not** claim more than one task in this run.",
  ].join("\n"),
]);

const tplSourcePr = ({ PR_ID }) => {
  const id = String(PR_ID || "").trim();
  return compose([
    `${FRAGMENTS.role} Source vendors for a specific Purchase Request — internal database + external web research, all submitted together.`,

    "## Target",
    `PR id: \`${id}\``,

    "## Steps",
    [
      `1. Call \`list_pending_tasks\` and find the sourcing task for PR \`${id}\`.`,
      "2. Call `claim_task` with the task id.",
      `3. Call \`get_purchase_request\` with PR id \`${id}\`.`,
      "",
      "**Phase 1 — Internal:**",
      "4. For each line item, call `search_vendors`. Note vendor ids + reference prices.",
      "5. Optionally `get_vendor_details` and `get_purchase_history`.",
      "6. `report_progress` after each search.",
      "",
      "**Phase 2 — External web research:**",
      "7. Web search 3–5 reputable external vendors per item.",
      "8. For EACH external vendor, get: name, contact email (REQUIRED), address, est. price, lead time.",
      "",
      "**Phase 3 — Submit (critical):**",
      `9. Call \`submit_vendor_shortlist(pr_id="${id}", shortlist=[...])\` with internal AND external vendors in the SAME array.`,
      "    - Internal: pass `vendorId`",
      "    - External: pass `vendor` object (auto-creates record + sends RFQ to their email)",
      "    - **External vendors NOT in this call get NO RFQ — listing in result text alone is useless.**",
      "10. Call `submit_result` with a comparison report.",
      "11. " + FRAGMENTS.failureRule,
    ].join("\n"),

    "## Payload format example",
    [
      "```json",
      "{",
      `  "pr_id": "${id}",`,
      "  \"shortlist\": [",
      "    { \"vendorId\": \"859b...\", \"lineItemId\": 5, \"referencePrice\": 3.20 },",
      "    {",
      "      \"vendor\": { \"name\": \"Huadong Cable\", \"email\": \"sales@huadongcable.com\", \"address\": \"China\", \"leadTimeDays\": 30 },",
      "      \"lineItemId\": 5,",
      "      \"referencePrice\": 2.80",
      "    }",
      "  ]",
      "}",
      "```",
    ].join("\n"),

    "## Rules",
    [
      "- 2+ internal vendors per item, 3–5 external alternatives.",
      "- External vendors MUST have a real contact email — that's where the RFQ goes.",
      "- Mix internal `vendorId` and external `vendor` objects in the same `submit_vendor_shortlist` call.",
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

const tplGenerateMockPrs = ({ COUNT, INDUSTRY }) => {
  const n = Math.max(1, Math.min(20, Number(COUNT) || 5));
  const industry = String(INDUSTRY || "").trim();
  return compose([
    `${FRAGMENTS.role} Generate realistic mock Purchase Requisitions and create them via the API.`,

    "## Goal",
    `Create ${n} diverse, realistic mock PR${n === 1 ? "" : "s"}${industry ? ` for the **${industry}** industry` : ""} so the team can test the procurement workflow with believable data.`,

    "## Steps",
    [
      `1. Brainstorm ${n} distinct procurement scenarios. Vary item types, quantities, urgency, and total estimated value.`,
      `2. For EACH PR, POST to \`/api/procurement/prs\` with this body:`,
      "",
      "```json",
      "{",
      "  \"title\":       \"Short, specific title (e.g. 'Q2 office supplies restock')\",",
      "  \"requestedBy\": \"realistic.name\",",
      "  \"deadline\":    1735689600000,   // optional UNIX ms epoch",
      "  \"notes\":       \"Constraints, preferred brands, budget hints\",",
      "  \"lineItems\": [",
      "    { \"materialName\": \"…\", \"specification\": \"…\", \"quantity\": 10, \"unit\": \"box\" }",
      "  ]",
      "}",
      "```",
      "",
      "3. Use 2–6 line items per PR. Mix realistic units (kg, m, box, set, ream, liter, ton, pcs).",
      "4. After all POSTs succeed, reply with a Markdown table summarising what you created (PR title, items count, requestedBy).",
    ].join("\n"),

    "## Variety guidelines",
    [
      "- Don't repeat the same material across PRs.",
      "- Mix small/cheap items (paper, cleaning supplies) with bigger procurements (HVAC, machinery, raw materials).",
      "- Use plausible specifications — sizes, grades, model numbers.",
      "- Some PRs should have a deadline, others none.",
    ].join("\n"),

    "## Hard rules",
    [
      "- Do NOT use procurement-agent MCP tools — this is a pure HTTP exercise.",
      "- Each PR must have at least one line item.",
      "- New PRs are auto-created in `pending_approval` status — do not call `/submit`.",
    ].join("\n"),
  ]);
};

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
    id: "generate-mock-prs",
    name: "Generate mock PRs",
    description: "Create N realistic mock Purchase Requisitions via the HTTP API for testing.",
    icon: "bi-magic",
    variables: [
      { key: "COUNT", label: "How many", placeholder: "e.g. 5", required: true },
      { key: "INDUSTRY", label: "Industry (optional)", placeholder: "e.g. construction, hospitality, biotech" },
    ],
    build: tplGenerateMockPrs,
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
