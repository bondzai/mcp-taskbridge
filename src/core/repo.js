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
    archivedAt: row.archived_at ?? null,
    model: row.model ?? null,
    tokensIn: row.tokens_in ?? null,
    tokensOut: row.tokens_out ?? null,
    totalTokens: row.total_tokens ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
};

export const createTasksRepository = (db) => {
  const insert = db.prepare(`
    INSERT INTO tasks (id, prompt, status, metadata, created_at, updated_at)
    VALUES (@id, @prompt, @status, @metadata, @now, @now)
  `);
  const selectById = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const selectPending = db.prepare(`
    SELECT * FROM tasks
     WHERE status = 'pending' AND archived_at IS NULL
     ORDER BY created_at ASC
     LIMIT ?
  `);
  const selectAllActive = db.prepare(`
    SELECT * FROM tasks
     WHERE archived_at IS NULL
     ORDER BY created_at DESC
     LIMIT ?
  `);
  const selectAllIncludingArchived = db.prepare(`
    SELECT * FROM tasks
     ORDER BY created_at DESC
     LIMIT ?
  `);
  const selectByAgent = db.prepare(`
    SELECT * FROM tasks
     WHERE agent_id = ? AND archived_at IS NULL
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
           model = COALESCE(@model, model),
           tokens_in = COALESCE(@tokensIn, tokens_in),
           tokens_out = COALESCE(@tokensOut, tokens_out),
           total_tokens = COALESCE(@totalTokens, total_tokens),
           completed_at = @now,
           updated_at = @now
     WHERE id = @id AND status = 'in_progress'
  `);
  const updatePrompt = db.prepare(`
    UPDATE tasks
       SET prompt = @prompt,
           updated_at = @now
     WHERE id = @id AND status = 'pending' AND archived_at IS NULL
  `);
  const archiveStmt = db.prepare(`
    UPDATE tasks
       SET archived_at = @now,
           updated_at = @now
     WHERE id = @id AND archived_at IS NULL
  `);
  const unarchiveStmt = db.prepare(`
    UPDATE tasks
       SET archived_at = NULL,
           updated_at = @now
     WHERE id = @id AND archived_at IS NOT NULL
  `);
  const deleteStmt = db.prepare(`DELETE FROM tasks WHERE id = ?`);
  const fail = db.prepare(`
    UPDATE tasks
       SET status = 'failed',
           error = @error,
           completed_at = @now,
           updated_at = @now
     WHERE id = @id AND status IN ('pending','in_progress')
  `);
  const progressUpdate = db.prepare(`
    UPDATE tasks
       SET progress = @message,
           updated_at = @now
     WHERE id = @id AND status = 'in_progress'
  `);
  const insertProgressLog = db.prepare(`
    INSERT INTO task_progress_log (task_id, message, step, total_steps, created_at)
    VALUES (@taskId, @message, @step, @totalSteps, @createdAt)
  `);
  const selectProgressLog = db.prepare(`
    SELECT * FROM task_progress_log WHERE task_id = ? ORDER BY created_at ASC, id ASC
  `);
  const progressTx = db.transaction((params) => {
    const upd = progressUpdate.run({ id: params.id, message: params.message, now: params.now });
    if (upd.changes === 0) return null;
    const info = insertProgressLog.run({
      taskId: params.id,
      message: params.message,
      step: params.step ?? null,
      totalSteps: params.totalSteps ?? null,
      createdAt: params.now,
    });
    return info.lastInsertRowid;
  });
  const countRows = db.prepare(`SELECT status, COUNT(*) as n FROM tasks GROUP BY status`);
  const pragmaJournalMode = db.prepare(`PRAGMA journal_mode`);

  const now = () => Date.now();

  return {
    insert(prompt, metadata) {
      const id = randomUUID();
      insert.run({
        id, prompt, status: TaskStatus.PENDING,
        metadata: metadata ? JSON.stringify(metadata) : null,
        now: now(),
      });
      return rowToTask(selectById.get(id));
    },
    getById(id) {
      if (!id) return null;
      return rowToTask(selectById.get(id));
    },
    listPending(limit) {
      return selectPending.all(limit).map(rowToTask);
    },
    listAll(limit, { includeArchived = false } = {}) {
      const stmt = includeArchived ? selectAllIncludingArchived : selectAllActive;
      return stmt.all(limit).map(rowToTask);
    },
    listByAgent(agentId, limit) {
      return selectByAgent.all(agentId, limit).map(rowToTask);
    },
    claim(id, agentId) {
      const info = claim.run({ id, agentId: agentId ?? null, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    complete(id, result, metadata = {}) {
      const info = complete.run({
        id,
        result,
        now: now(),
        model: metadata.model ?? null,
        tokensIn: metadata.tokensIn ?? null,
        tokensOut: metadata.tokensOut ?? null,
        totalTokens: metadata.totalTokens ?? null,
      });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    updatePrompt(id, prompt) {
      const info = updatePrompt.run({ id, prompt, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    archive(id) {
      const info = archiveStmt.run({ id, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    unarchive(id) {
      const info = unarchiveStmt.run({ id, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    delete(id) {
      const info = deleteStmt.run(id);
      return info.changes > 0;
    },
    fail(id, error) {
      const info = fail.run({ id, error, now: now() });
      if (info.changes === 0) return null;
      return rowToTask(selectById.get(id));
    },
    progress(id, message, { step, totalSteps } = {}) {
      const ts = now();
      const logId = progressTx({ id, message, step, totalSteps, now: ts });
      if (logId == null) return null;
      const task = rowToTask(selectById.get(id));
      if (!task) return null;
      return {
        task,
        entry: { id: Number(logId), taskId: id, message, step: step ?? null, totalSteps: totalSteps ?? null, createdAt: ts },
      };
    },
    getProgressLog(taskId) {
      return selectProgressLog.all(taskId).map((r) => ({
        id: r.id,
        taskId: r.task_id,
        message: r.message,
        step: r.step,
        totalSteps: r.total_steps,
        createdAt: r.created_at,
      }));
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

/* ---------- Attachments repository ---------- */

const rowToAttachment = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    content: row.content ?? undefined,
    createdAt: row.created_at,
  };
};

export const createAttachmentsRepository = (db) => {
  const insertOne = db.prepare(`
    INSERT INTO task_attachments (task_id, filename, mime_type, size, content, created_at)
    VALUES (@taskId, @filename, @mimeType, @size, @content, @createdAt)
  `);
  const selectMeta = db.prepare(`
    SELECT id, task_id, filename, mime_type, size, created_at
      FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC
  `);
  const selectFull = db.prepare(`
    SELECT * FROM task_attachments WHERE id = ? AND task_id = ?
  `);

  const insertMany = db.transaction((taskId, files, ts) => {
    const out = [];
    for (const f of files) {
      const info = insertOne.run({
        taskId, filename: f.filename, mimeType: f.mimeType,
        size: f.size, content: f.content, createdAt: ts,
      });
      out.push({ id: Number(info.lastInsertRowid), taskId, filename: f.filename, mimeType: f.mimeType, size: f.size, createdAt: ts });
    }
    return out;
  });

  return {
    insertMany(taskId, files) {
      return insertMany(taskId, files, Date.now());
    },
    listByTaskId(taskId) {
      return selectMeta.all(taskId).map(rowToAttachment);
    },
    getById(taskId, attachmentId) {
      return rowToAttachment(selectFull.get(attachmentId, taskId));
    },
  };
};
