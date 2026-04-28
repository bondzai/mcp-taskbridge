import { TaskEvents } from "./events.js";
import { TaskStatus } from "./status.js";

const MAX_PROMPT_LEN = 8_000;
const MAX_RESULT_LEN = 64_000;
const MAX_PROGRESS_LEN = 2_000;
const MAX_REASON_LEN = 2_000;
const MAX_AGENT_LEN = 128;
const MAX_MODEL_LEN = 128;
const MAX_TOKENS = 100_000_000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "text/plain"]);

const cleanModel = (value) => {
  if (value == null) return null;
  if (typeof value !== "string") throw new ValidationError("model must be a string");
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_MODEL_LEN) throw new ValidationError(`model exceeds ${MAX_MODEL_LEN} chars`);
  return trimmed;
};

const cleanTokenCount = (value, field) => {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  if (value < 0) throw new ValidationError(`${field} must be non-negative`);
  if (value > MAX_TOKENS) throw new ValidationError(`${field} exceeds ${MAX_TOKENS}`);
  return value;
};

const cleanCompleteMetadata = (raw) => {
  if (!raw || typeof raw !== "object") return {};
  const model = cleanModel(raw.model);
  const tokensIn = cleanTokenCount(raw.tokensIn, "tokens_in");
  const tokensOut = cleanTokenCount(raw.tokensOut, "tokens_out");
  let totalTokens = cleanTokenCount(raw.totalTokens, "total_tokens");
  if (totalTokens == null && tokensIn != null && tokensOut != null) {
    totalTokens = tokensIn + tokensOut;
  }
  return { model, tokensIn, tokensOut, totalTokens };
};

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

export const createTaskService = ({ repo, events, attachmentsRepo }) => {
  if (!repo) throw new Error("repo is required");
  if (!events) throw new Error("events bus is required");

  const emit = (event, data) => events.emit(event, data);

  const mustExist = async (id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ValidationError("task id is required");
    }
    const task = await repo.getById(id);
    if (!task) throw new NotFoundError(id);
    return task;
  };

  return {
    async create(prompt, files) {
      const cleaned = requireNonEmptyString(prompt, "prompt", MAX_PROMPT_LEN);
      if (files && files.length > 0) {
        if (!attachmentsRepo) throw new ValidationError("file attachments not supported");
        if (files.length > MAX_ATTACHMENTS) throw new ValidationError(`max ${MAX_ATTACHMENTS} attachments`);
        for (const f of files) {
          if (!ALLOWED_MIME_TYPES.has(f.mimeType)) throw new ValidationError(`unsupported file type: ${f.mimeType}`);
          if (f.size > MAX_ATTACHMENT_SIZE) throw new ValidationError(`file exceeds ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB limit`);
        }
      }
      const task = await repo.insert(cleaned);
      let attachments = [];
      if (files && files.length > 0) {
        attachments = await attachmentsRepo.insertMany(task.id, files);
      }
      const result = attachments.length > 0 ? { ...task, attachments } : task;
      await emit(TaskEvents.CREATED, result);
      return result;
    },

    async get(id) {
      return mustExist(id);
    },

    async listPending(limit) {
      return repo.listPending(clampLimit(limit, 20, 50));
    },

    async listAll(limit, opts = {}) {
      return repo.listAll(clampLimit(limit, 100, 500), opts);
    },

    async listByAgent(agentId, limit) {
      const cleaned = requireNonEmptyString(agentId, "agent_id", MAX_AGENT_LEN);
      return repo.listByAgent(cleaned, clampLimit(limit, 100, 500));
    },

    async claim(id, agentId) {
      const existing = await mustExist(id);
      if (existing.status !== TaskStatus.PENDING) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot claim`);
      }
      const cleanedAgent =
        agentId == null ? null : requireNonEmptyString(agentId, "agent_id", MAX_AGENT_LEN);
      const claimed = await repo.claim(id, cleanedAgent);
      if (!claimed) throw new ConflictError(`task ${id} was claimed by another worker`);
      await emit(TaskEvents.CLAIMED, claimed);
      return claimed;
    },

    async complete(id, result, metadata) {
      const cleaned = requireNonEmptyString(result, "result", MAX_RESULT_LEN);
      const cleanedMeta = cleanCompleteMetadata(metadata);
      const existing = await mustExist(id);
      if (existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot complete`);
      }
      const done = await repo.complete(id, cleaned, cleanedMeta);
      if (!done) throw new ConflictError(`task ${id} could not be completed`);
      await emit(TaskEvents.COMPLETED, done);
      return done;
    },

    async updatePrompt(id, prompt) {
      const cleaned = requireNonEmptyString(prompt, "prompt", MAX_PROMPT_LEN);
      const existing = await mustExist(id);
      if (existing.archivedAt != null) {
        throw new ConflictError(`task ${id} is archived, cannot update`);
      }
      if (existing.status !== TaskStatus.PENDING) {
        throw new ConflictError(`task ${id} is ${existing.status}, prompt is locked`);
      }
      const updated = await repo.updatePrompt(id, cleaned);
      if (!updated) throw new ConflictError(`task ${id} could not be updated`);
      await emit(TaskEvents.UPDATED, updated);
      return updated;
    },

    async archive(id) {
      const existing = await mustExist(id);
      if (existing.archivedAt != null) {
        return existing; // idempotent
      }
      const archived = await repo.archive(id);
      if (!archived) throw new ConflictError(`task ${id} could not be archived`);
      await emit(TaskEvents.ARCHIVED, archived);
      return archived;
    },

    async unarchive(id) {
      const existing = await mustExist(id);
      if (existing.archivedAt == null) {
        return existing; // idempotent
      }
      const unarchived = await repo.unarchive(id);
      if (!unarchived) throw new ConflictError(`task ${id} could not be unarchived`);
      await emit(TaskEvents.UNARCHIVED, unarchived);
      return unarchived;
    },

    async delete(id) {
      const existing = await mustExist(id);
      const ok = await repo.delete(id);
      if (!ok) throw new ConflictError(`task ${id} could not be deleted`);
      // Emit a minimal payload — the row is gone, so tell subscribers just the id.
      await emit(TaskEvents.DELETED, { id: existing.id });
      return { id: existing.id, deleted: true };
    },

    async fail(id, reason) {
      const cleaned = requireNonEmptyString(reason, "reason", MAX_REASON_LEN);
      const existing = await mustExist(id);
      if (existing.status !== TaskStatus.PENDING && existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(`task ${id} is ${existing.status}, cannot fail`);
      }
      const failed = await repo.fail(id, cleaned);
      if (!failed) throw new ConflictError(`task ${id} could not be failed`);
      await emit(TaskEvents.FAILED, failed);
      return failed;
    },

    async getAttachments(id) {
      await mustExist(id);
      return attachmentsRepo ? attachmentsRepo.listByTaskId(id) : [];
    },

    async getAttachmentContent(id, attachmentId) {
      await mustExist(id);
      if (!attachmentsRepo) throw new NotFoundError(`attachment ${attachmentId}`);
      const att = await attachmentsRepo.getById(id, attachmentId);
      if (!att) throw new NotFoundError(`attachment ${attachmentId}`);
      return att;
    },

    async progress(id, message, { step, totalSteps } = {}) {
      const cleaned = requireNonEmptyString(message, "message", MAX_PROGRESS_LEN);
      const existing = await mustExist(id);
      if (existing.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError(
          `task ${id} is ${existing.status}, progress only valid when in_progress`
        );
      }
      if (step != null) {
        if (!Number.isInteger(step) || step < 0) throw new ValidationError("step must be a non-negative integer");
      }
      if (totalSteps != null) {
        if (!Number.isInteger(totalSteps) || totalSteps < 1) throw new ValidationError("total_steps must be a positive integer");
      }
      const result = await repo.progress(id, cleaned, { step, totalSteps });
      if (!result) throw new ConflictError(`task ${id} progress not recorded`);
      await emit(TaskEvents.PROGRESS, { ...result.task, progressEntry: result.entry });
      return result;
    },

    async getProgressLog(id) {
      await mustExist(id);
      return repo.getProgressLog(id);
    },
  };
};
