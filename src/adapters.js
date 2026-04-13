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
