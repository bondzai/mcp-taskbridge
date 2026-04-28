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
  const now = () => Date.now();

  return {
    async insert(prompt, metadata) {
      const id = randomUUID();
      const ts = now();
      await db.execute(
        `INSERT INTO tasks (id, prompt, status, metadata, created_at, updated_at)
         VALUES (@id, @prompt, @status, @metadata, @now, @now)`,
        {
          id, prompt, status: TaskStatus.PENDING,
          metadata: metadata ? JSON.stringify(metadata) : null,
          now: ts,
        }
      );
      return this.getById(id);
    },
    async getById(id) {
      if (!id) return null;
      const row = await db.queryOne(`SELECT * FROM tasks WHERE id = @id`, { id });
      return rowToTask(row);
    },
    async listPending(limit) {
      const rows = await db.query(
        `SELECT * FROM tasks
          WHERE status = 'pending' AND archived_at IS NULL
          ORDER BY created_at ASC
          LIMIT @limit`,
        { limit }
      );
      return rows.map(rowToTask);
    },
    async listAll(limit, { includeArchived = false } = {}) {
      const sql = includeArchived
        ? `SELECT * FROM tasks ORDER BY created_at DESC LIMIT @limit`
        : `SELECT * FROM tasks WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT @limit`;
      const rows = await db.query(sql, { limit });
      return rows.map(rowToTask);
    },
    async listByAgent(agentId, limit) {
      const rows = await db.query(
        `SELECT * FROM tasks
          WHERE agent_id = @agentId AND archived_at IS NULL
          ORDER BY created_at DESC
          LIMIT @limit`,
        { agentId, limit }
      );
      return rows.map(rowToTask);
    },
    async claim(id, agentId) {
      const ts = now();
      const result = await db.execute(
        `UPDATE tasks
            SET status = 'in_progress',
                agent_id = @agentId,
                claimed_at = @now,
                updated_at = @now
          WHERE id = @id AND status = 'pending'`,
        { id, agentId: agentId ?? null, now: ts }
      );
      if (result.changes === 0) return null;
      return this.getById(id);
    },
    async complete(id, result, metadata = {}) {
      const ts = now();
      const info = await db.execute(
        `UPDATE tasks
            SET status = 'done',
                result = @result,
                model = COALESCE(@model, model),
                tokens_in = COALESCE(@tokensIn, tokens_in),
                tokens_out = COALESCE(@tokensOut, tokens_out),
                total_tokens = COALESCE(@totalTokens, total_tokens),
                completed_at = @now,
                updated_at = @now
          WHERE id = @id AND status = 'in_progress'`,
        {
          id,
          result,
          now: ts,
          model: metadata.model ?? null,
          tokensIn: metadata.tokensIn ?? null,
          tokensOut: metadata.tokensOut ?? null,
          totalTokens: metadata.totalTokens ?? null,
        }
      );
      if (info.changes === 0) return null;
      return this.getById(id);
    },
    async updatePrompt(id, prompt) {
      const ts = now();
      const info = await db.execute(
        `UPDATE tasks
            SET prompt = @prompt,
                updated_at = @now
          WHERE id = @id AND status = 'pending' AND archived_at IS NULL`,
        { id, prompt, now: ts }
      );
      if (info.changes === 0) return null;
      return this.getById(id);
    },
    async archive(id) {
      const ts = now();
      const info = await db.execute(
        `UPDATE tasks
            SET archived_at = @now,
                updated_at = @now
          WHERE id = @id AND archived_at IS NULL`,
        { id, now: ts }
      );
      if (info.changes === 0) return null;
      return this.getById(id);
    },
    async unarchive(id) {
      const ts = now();
      const info = await db.execute(
        `UPDATE tasks
            SET archived_at = NULL,
                updated_at = @now
          WHERE id = @id AND archived_at IS NOT NULL`,
        { id, now: ts }
      );
      if (info.changes === 0) return null;
      return this.getById(id);
    },
    async delete(id) {
      const info = await db.execute(
        `DELETE FROM tasks WHERE id = @id`,
        { id }
      );
      return info.changes > 0;
    },
    async fail(id, error) {
      const ts = now();
      const info = await db.execute(
        `UPDATE tasks
            SET status = 'failed',
                error = @error,
                completed_at = @now,
                updated_at = @now
          WHERE id = @id AND status IN ('pending','in_progress')`,
        { id, error, now: ts }
      );
      if (info.changes === 0) return null;
      return this.getById(id);
    },
    async progress(id, message, { step, totalSteps } = {}) {
      const ts = now();
      return db.transaction(async (tx) => {
        const upd = await tx.execute(
          `UPDATE tasks
              SET progress = @message,
                  updated_at = @now
            WHERE id = @id AND status = 'in_progress'`,
          { id, message, now: ts }
        );
        if (upd.changes === 0) return null;
        const logResult = await tx.execute(
          `INSERT INTO task_progress_log (task_id, message, step, total_steps, created_at)
           VALUES (@taskId, @message, @step, @totalSteps, @createdAt)`,
          {
            taskId: id,
            message,
            step: step ?? null,
            totalSteps: totalSteps ?? null,
            createdAt: ts,
          }
        );
        const logId = logResult.lastId;
        const row = await tx.queryOne(`SELECT * FROM tasks WHERE id = @id`, { id });
        const task = rowToTask(row);
        if (!task) return null;
        return {
          task,
          entry: { id: Number(logId), taskId: id, message, step: step ?? null, totalSteps: totalSteps ?? null, createdAt: ts },
        };
      });
    },
    async getProgressLog(taskId) {
      const rows = await db.query(
        `SELECT * FROM task_progress_log WHERE task_id = @taskId ORDER BY created_at ASC, id ASC`,
        { taskId }
      );
      return rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        message: r.message,
        step: r.step,
        totalSteps: r.total_steps,
        createdAt: r.created_at,
      }));
    },
    async countByStatus() {
      const rows = await db.query(
        `SELECT status, COUNT(*) as n FROM tasks GROUP BY status`,
        {}
      );
      const out = { total: 0, pending: 0, in_progress: 0, done: 0, failed: 0 };
      for (const row of rows) {
        if (row.status in out) out[row.status] = row.n;
        out.total += row.n;
      }
      return out;
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
  return {
    async insertMany(taskId, files) {
      const ts = Date.now();
      return db.transaction(async (tx) => {
        const out = [];
        for (const f of files) {
          const info = await tx.execute(
            `INSERT INTO task_attachments (task_id, filename, mime_type, size, content, created_at)
             VALUES (@taskId, @filename, @mimeType, @size, @content, @createdAt)`,
            {
              taskId, filename: f.filename, mimeType: f.mimeType,
              size: f.size, content: f.content, createdAt: ts,
            }
          );
          out.push({ id: Number(info.lastId), taskId, filename: f.filename, mimeType: f.mimeType, size: f.size, createdAt: ts });
        }
        return out;
      });
    },
    async listByTaskId(taskId) {
      const rows = await db.query(
        `SELECT id, task_id, filename, mime_type, size, created_at
           FROM task_attachments WHERE task_id = @taskId ORDER BY created_at ASC`,
        { taskId }
      );
      return rows.map(rowToAttachment);
    },
    async getById(taskId, attachmentId) {
      const row = await db.queryOne(
        `SELECT * FROM task_attachments WHERE id = @attachmentId AND task_id = @taskId`,
        { attachmentId, taskId }
      );
      return rowToAttachment(row);
    },
  };
};
