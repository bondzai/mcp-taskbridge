/* ============================================================
   Prompt library — well-engineered prompts users can copy
   into Claude Cowork, Claude Desktop, Claude Code, or any
   other MCP client that has the taskbridge connector enabled.

   Design notes (prompt-engineering best practices applied):
   - Clear role / context up front.
   - Explicit, numbered tool-call sequence (MCP tools are named).
   - Explicit DO and DO-NOT boundaries.
   - Failure path is first-class (fail_task with reason).
   - Output format is specified where it matters.
   - Variables are {UPPERCASE_SNAKE} placeholders, easy to spot.
   ============================================================ */

export const PROMPT_TEMPLATES = [
  {
    id: "solve-oldest",
    name: "Solve oldest pending task",
    description: "Claim the single oldest pending task and complete it end-to-end.",
    icon: "bi-play-circle",
    variables: [],
    build: () => `You are an MCP agent connected to the **taskbridge** connector. Your job is to pick up and complete ONE task from the pending queue.

Do exactly this, using the taskbridge tools as named:

1. Call \`list_pending_tasks\` to see what is waiting.
2. If the list is empty, reply "No pending tasks." and stop.
3. Otherwise pick the **oldest** task (smallest \`createdAt\`).
4. Call \`claim_task\` with that task's \`id\`. This transitions it to \`in_progress\` and tags it with your agent id.
5. Read the task's \`prompt\` field carefully. Use whatever other tools you have (web search, code execution, file tools, reasoning) to do the actual work.
6. While you work, optionally call \`report_progress\` with short, user-facing status updates so the submitter can see you're alive. Keep each under 200 characters.
7. When you have the final answer, call \`submit_result\` with the task's \`id\` and a **well-formatted Markdown** result. The result is what the submitter sees in the browser, so:
   - Lead with the answer, not the process.
   - Use headings, lists, and tables where they add clarity.
   - Cite sources as Markdown links when you looked something up.
   - **If you know your model identifier and token usage, pass them as optional arguments**: \`model\` (e.g. \`"claude-opus-4-6"\`, \`"gpt-5"\`, \`"codex-1"\`), \`tokens_in\`, \`tokens_out\`, \`total_tokens\`. Taskbridge surfaces these on the dashboard so the submitter can see the cost.
8. If you cannot complete the task — ambiguous, unsafe, out of scope, or missing context — call \`fail_task\` with the \`id\` and a short reason (≤ 2 sentences). Do NOT guess.

Rules:
- Use taskbridge tools ONLY for state transitions (claim / progress / submit / fail).
- Do NOT claim more than one task in this run.
- Do NOT modify tasks you did not claim.
`,
  },

  {
    id: "solve-this",
    name: "Solve this specific task",
    description: "Claim a task by id and complete it. The id is pre-filled from the current task.",
    icon: "bi-bullseye",
    variables: [
      { key: "TASK_ID", label: "Task id", placeholder: "e.g. 423b0b0d-...", required: true },
      { key: "PROMPT_PREVIEW", label: "Prompt preview (optional)", placeholder: "pasted from the task card", required: false, textarea: true },
    ],
    build: ({ TASK_ID, PROMPT_PREVIEW }) => {
      const preview = (PROMPT_PREVIEW || "").trim();
      return `You are an MCP agent connected to the **taskbridge** connector. There is one specific task you must handle. Its id is:

    ${TASK_ID}

Do exactly this:

1. Call \`get_task\` with id \`${TASK_ID}\` to read its current \`prompt\` and \`status\`.
2. If the status is not \`pending\`, stop and report what the status is. Do NOT try to claim an already-claimed task.
3. Call \`claim_task\` with id \`${TASK_ID}\`.
4. Complete the work described in the task's \`prompt\` field, using whatever other tools you have (web search, code execution, file tools). Focus on the submitter's actual intent; if the prompt is ambiguous, interpret it charitably but be explicit about your interpretation in the result.
5. (Optional) Call \`report_progress\` with a short status update while you work.
6. Call \`submit_result\` with id \`${TASK_ID}\` and a **well-formatted Markdown** answer. Lead with the conclusion, then supporting detail. Cite sources as Markdown links. **Pass the optional \`model\`, \`tokens_in\`, \`tokens_out\`, \`total_tokens\` arguments if your runtime exposes them — taskbridge displays them on the dashboard.**
7. If you cannot complete the task, call \`fail_task\` with id \`${TASK_ID}\` and a ≤ 2 sentence reason. Do NOT guess.

Constraints:
- Only touch task \`${TASK_ID}\`. Do not claim, modify, or submit any other task.
- Use taskbridge tools ONLY for state transitions.
${preview ? `\nTask prompt preview (for context — still call \`get_task\` for the authoritative version):\n\n> ${preview.split("\n").join("\n> ")}\n` : ""}`;
    },
  },

  {
    id: "triage",
    name: "Triage the pending queue (read-only)",
    description: "Categorize every pending task without claiming any — useful for planning.",
    icon: "bi-clipboard-data",
    variables: [],
    build: () => `You are a triage assistant connected to the **taskbridge** connector. Your job is to categorize, not to execute.

Do exactly this:

1. Call \`list_pending_tasks\` to get every currently-pending task.
2. For each task, infer:
   - **type** — one of: research, summarize, code, data lookup, creative, other
   - **difficulty** — one of: trivial, moderate, hard
   - **one-line summary** — ≤ 80 characters, plain English
3. Return a single Markdown table with columns:

   | id (short) | type | difficulty | summary |

   Use the first 8 characters of each task's \`id\` as the short id.

Hard rules:
- Do NOT call \`claim_task\`, \`submit_result\`, \`fail_task\`, or \`report_progress\`.
- This is a read-only pass. If the queue is empty, say so and stop.
`,
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
    build: ({ TASK_ID, REASON }) => `You are an MCP agent connected to the **taskbridge** connector. Mark the task below as failed and stop.

Steps:

1. Call \`fail_task\` with:
   - \`id\`: \`${TASK_ID}\`
   - \`reason\`: the exact text below, verbatim.
2. Do not claim, do not submit, do not touch any other task.
3. After the tool call succeeds, reply with a single sentence confirming the failure.

Reason to pass to \`fail_task\`:

${(REASON || "").trim()}
`,
  },
];

export const getTemplate = (id) => PROMPT_TEMPLATES.find((t) => t.id === id);

export const buildPrompt = (id, vars = {}) => {
  const tpl = getTemplate(id);
  if (!tpl) throw new Error(`unknown prompt template: ${id}`);
  return tpl.build(vars).trim() + "\n";
};

/* Clipboard — tries the modern API first, falls back to a hidden textarea. */
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
