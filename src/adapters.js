const SHARED_CONTRACT =
  "When you finish this task you MUST call submit_result(task_id, result). " +
  "If you cannot complete it, call fail_task(task_id, reason). " +
  "Do not end your turn without calling one of those tools.";

export const ADAPTERS = Object.freeze({
  "claude-desktop": {
    id: "claude-desktop",
    label: "Claude Desktop",
    instructions: SHARED_CONTRACT,
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    instructions: SHARED_CONTRACT,
  },
  "claude-cowork": {
    id: "claude-cowork",
    label: "Claude Cowork",
    instructions:
      SHARED_CONTRACT +
      " Cowork runs many agents in parallel; always include your agent_id when claiming.",
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    instructions:
      SHARED_CONTRACT +
      " The task prompt is the authoritative brief — do NOT try to infer it" +
      " from files in the current working directory, and do NOT treat it as" +
      " a request to edit this repo unless the prompt explicitly says so." +
      " Use your own tools (shell, search, apply) to do the work, then call" +
      " submit_result with a well-formatted Markdown answer.",
  },
  antigravity: {
    id: "antigravity",
    label: "Google Antigravity",
    instructions:
      SHARED_CONTRACT +
      " You are running inside an IDE, so file and terminal tools are" +
      " available — use them freely to complete the task. If multiple" +
      " sub-agents are spawned, only ONE should call claim_task for a" +
      " given id; the rest must read via get_task.",
  },
  generic: {
    id: "generic",
    label: "Generic MCP Client",
    instructions: SHARED_CONTRACT,
  },
});

export const resolveAdapter = (id) => {
  if (!id) return ADAPTERS.generic;
  return ADAPTERS[id] ?? ADAPTERS.generic;
};
