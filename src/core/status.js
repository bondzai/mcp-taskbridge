export const TaskStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  FAILED: "failed",
});

export const TERMINAL_STATUSES = new Set([TaskStatus.DONE, TaskStatus.FAILED]);
