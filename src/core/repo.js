import { randomUUID } from "node:crypto";
import { TaskStatus } from "./status.js";

const rowToTask = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    agentId: row.agent_id,
    result: row.result,
    error: row.error,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
  };
};

export const createTasksRepository = (db) => {
  const insert = db.prepare(`
    INSERT INTO tasks (id, prompt, status, created_at, updated_at)
    VALUES (@id, @prompt, @status, @now, @now)
  `);
  const selectById = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const selectPending = db.prepare(`
    SELECT * FROM tasks WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `);
  const selectAll = db.prepare(`
    SELECT * FROM tasks
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const selectByAgent = db.prepare(`
    SELECT * FROM tasks WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const claim = db.prepare(`
    UPDATE tasks
       SET status = 'in_progress',
           agent_id = @agentId,
           claimed_at = @now,
           updated_at = @now
     WHERE id = @id AND status = 'pending'
  `);
  const complete = db.prepare(`
    UPDATE tasks
       SET status = 'done',
           result = @result,
           completed_at = @now,
           updated_at = @now
     WHERE id = @id AND status = 'in_progress'
  `);
  const fail = db.prepare(`
    UPDATE tasks
       SET status = 'failed',
           error = @error,
           completed_at = @now,
           updated_at = @now
     WHERE id = @id AND status IN ('pending','in_progress')
  `);
  const progress = db.prepare(`
    UPDATE tasks
       SET progress = @message,
           updated_at = @now
     WHERE id = @id AND status = 'in_progress'
  `);
  const countRows = db.prepare(`SELECT status, COUNT(*) as n FROM tasks GROUP BY status`);
  const pragmaJournalMode = db.prepare(`PRAGMA journal_mode`);

  const now = () => Date.now();

  return {
    insert(prompt) {
      const id = randomUUID();
      insert.run({ id, prompt, status: TaskStatus.PENDING, now: now() });
      return rowToTask(selectById.get(id));
    },
    getById(id) {
      if (!id) return null;
      return rowToTask(selectById.get(id));
    },
    listPending(limit) {
      return selectPending.all(limit).map(rowToTask);
    },
    listAll(limit) {
      return selectAll.all(limit).map(rowToTask);
    },
    listByAgent(agentId, limit) {
      return selectByAgent.all(agentId, limit).map(rowToTask);
    },
    claim(id, agentId) {
      const info = claim.run({ id, agentId: agentId ?? null, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    complete(id, result) {
      const info = complete.run({ id, result, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    fail(id, error) {
      const info = fail.run({ id, error, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    progress(id, message) {
      const info = progress.run({ id, message, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    countByStatus() {
      const out = { total: 0, pending: 0, in_progress: 0, done: 0, failed: 0 };
      for (const row of countRows.all()) {
        if (row.status in out) out[row.status] = row.n;
        out.total += row.n;
      }
      return out;
    },
    journalMode() {
      const row = pragmaJournalMode.get();
      return row?.journal_mode ?? null;
    },
  };
};
