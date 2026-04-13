import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed')),
  agent_id       TEXT,
  result         TEXT,
  error          TEXT,
  progress       TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  claimed_at     INTEGER,
  completed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
`;

const ensureDirectory = (filePath) => {
  if (filePath === ":memory:") return;
  const dir = path.dirname(filePath);
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
};

export const openDatabase = (filePath) => {
  ensureDirectory(filePath);
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
};
