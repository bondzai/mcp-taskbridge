import { TaskEvents } from "./events.js";
import { TaskStatus } from "./status.js";

const MAX_PROMPT_LEN = 8_000;
const MAX_RESULT_LEN = 64_000;
const MAX_PROGRESS_LEN = 2_000;
const MAX_REASON_LEN = 2_000;
const MAX_AGENT_LEN = 128;

const requireNonEmptyString = (value, field, max) => {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === "") throw new ValidationError(`${field} must be non-empty`);
  if (trimmed.length > max) throw new ValidationError(`${field} exceeds ${max} chars`);
  return trimmed;
};

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION";
  }
}

export class NotFoundError extends Error {
  constructor(id) {
    super(`task ${id} not found`);
    this.name = "NotFoundError";
    this.code = "NOT_FOUND";
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.code = "CONFLICT";
  }
}

const clampLimit = (limit, fallback, max) => {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

export const createTaskService = ({ repo, events }) => {
  if (!repo) throw new Error("repo is required");
  if (!events) throw new Error("events bus is required");

  const emit = (event, data) => events.emit(event, data);

  const mustExist = (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("task id is required");
    }
    const task = repo.getById(id);
    if (!task) throw new NotFoundError(id);
    return task;
  };

  return {
    async create(prompt) {
      const cleaned = requireNonEmptyString(prompt, "prompt", MAX_PROMPT_LEN);
      const task = repo.insert(cleaned);
      await emit(TaskEvents.CREATED, task);
      return task;
    },

    get(id) {
      return mustExist(id);
    },

    listPending(limit) {
      return repo.listPending(clampLimit(limit, 20, 50));
    },

    listAll(limit) {
      return repo.listAll(clampLimit(limit, 100, 500));
    },

    listByAgent(agentId, limit) {
      const cleaned = requireNonEmptyString(agentId, "agent_id", MAX_AGENT_LEN);
      return repo.listByAgent(cleaned, clampLimit(limit, 100, 500));
    },

    async claim(id, agentId) {
      const existing = mustExist(id);
      if (existing.status !== TaskStatus.PENDING) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot claim`);
      }
      const cleanedAgent =
        agentId == null ? null : requireNonEmptyString(agentId, "agent_id", MAX_AGENT_LEN);
      const claimed = repo.claim(id, cleanedAgent);
      if (!claimed) throw new ConflictError(`task ${id} was claimed by another worker`);
      await emit(TaskEvents.CLAIMED, claimed);
      return claimed;
    },

    async complete(id, result) {
      const cleaned = requireNonEmptyString(result, "result", MAX_RESULT_LEN);
      const existing = mustExist(id);
      if (existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot complete`);
      }
      const done = repo.complete(id, cleaned);
      if (!done) throw new ConflictError(`task ${id} could not be completed`);
      await emit(TaskEvents.COMPLETED, done);
      return done;
    },

    async fail(id, reason) {
      const cleaned = requireNonEmptyString(reason, "reason", MAX_REASON_LEN);
      const existing = mustExist(id);
      if (existing.status !== TaskStatus.PENDING && existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot fail`);
      }
      const failed = repo.fail(id, cleaned);
      if (!failed) throw new ConflictError(`task ${id} could not be failed`);
      await emit(TaskEvents.FAILED, failed);
      return failed;
    },

    async progress(id, message) {
      const cleaned = requireNonEmptyString(message, "message", MAX_PROGRESS_LEN);
      const existing = mustExist(id);
      if (existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(
          `task ${id} is ${existing.status}, progress only valid when in_progress`
        );
      }
      const updated = repo.progress(id, cleaned);
      if (!updated) throw new ConflictError(`task ${id} progress not recorded`);
      await emit(TaskEvents.PROGRESS, updated);
      return updated;
    },
  };
};
