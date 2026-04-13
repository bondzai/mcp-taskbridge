import { z } from "zod";
import { resolveAdapter } from "../../adapters.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/service.js";

const ok = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

const err = (message, code = "INTERNAL") => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: message, code }) }],
});

const toError = (e) => {
  if (e instanceof ValidationError) return err(e.message, "VALIDATION");
  if (e instanceof NotFoundError) return err(e.message, "NOT_FOUND");
  if (e instanceof ConflictError) return err(e.message, "CONFLICT");
  return err(e?.message ?? "unknown error", "INTERNAL");
};

export const createToolHandlers = ({ service, adapterId }) => {
  const adapter = resolveAdapter(adapterId);
  const agentForClaim = adapter.id;

  const wrap = (fn) => async (args) => {
    try {
      return ok(await fn(args ?? {}));
    } catch (e) {
      return toError(e);
    }
  };

  return {
    adapter,
    listPending: wrap(async ({ limit }) => {
      const pending = service.listPending(limit);
      return { count: pending.length, tasks: pending };
    }),
    getTask: wrap(async ({ task_id }) => service.get(task_id)),
    claimTask: wrap(async ({ task_id, agent_id }) => {
      const claimed = await service.claim(task_id, agent_id ?? agentForClaim);
      return { task: claimed, instructions: adapter.instructions };
    }),
    submitResult: wrap(async ({ task_id, result }) => {
      const done = await service.complete(task_id, result);
      return { ok: true, task: done };
    }),
    failTask: wrap(async ({ task_id, reason }) => {
      const failed = await service.fail(task_id, reason);
      return { ok: true, task: failed };
    }),
    reportProgress: wrap(async ({ task_id, message }) => {
      const updated = await service.progress(task_id, message);
      return { ok: true, task: updated };
    }),
  };
};

export const toolDefinitions = (handlers) => [
  {
    name: "list_pending_tasks",
    config: {
      title: "List Pending Tasks",
      description:
        "Return tasks with status=pending waiting to be handled. Call this first to discover work.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional()
          .describe("Max tasks to return (default 20)"),
      },
    },
    run: (args) => handlers.listPending(args ?? {}),
  },
  {
    name: "get_task",
    config: {
      title: "Get Task",
      description: "Fetch full details of a single task by id.",
      inputSchema: { task_id: z.string().describe("Task id") },
    },
    run: (args) => handlers.getTask(args),
  },
  {
    name: "claim_task",
    config: {
      title: "Claim Task",
      description:
        "Transition a pending task to in_progress so you can start working on it. " +
        "Pass an optional agent_id to identify your worker. " +
        "You must claim before calling submit_result or report_progress.",
      inputSchema: {
        task_id: z.string().describe("Task id to claim"),
        agent_id: z.string().max(128).optional()
          .describe("Optional worker id. Defaults to the configured adapter id."),
      },
    },
    run: (args) => handlers.claimTask(args),
  },
  {
    name: "submit_result",
    config: {
      title: "Submit Result",
      description:
        "Mark an in_progress task as done and deliver the result. " +
        "This fires the task.completed webhook back to the web server.",
      inputSchema: {
        task_id: z.string().describe("Task id"),
        result: z.string().describe("Final result text for the user"),
      },
    },
    run: (args) => handlers.submitResult(args),
  },
  {
    name: "fail_task",
    config: {
      title: "Fail Task",
      description:
        "Mark a task as failed when you cannot complete it. Fires the task.failed webhook.",
      inputSchema: {
        task_id: z.string().describe("Task id"),
        reason: z.string().describe("Why the task could not be completed"),
      },
    },
    run: (args) => handlers.failTask(args),
  },
  {
    name: "report_progress",
    config: {
      title: "Report Progress",
      description:
        "Stream a short progress update for an in_progress task. Optional but helps the UI.",
      inputSchema: {
        task_id: z.string().describe("Task id"),
        message: z.string().describe("Short status update"),
      },
    },
    run: (args) => handlers.reportProgress(args),
  },
];
