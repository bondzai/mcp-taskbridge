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
  completed_at   INTEGER,
  archived_at    INTEGER,
  model          TEXT,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  total_tokens   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
-- idx_tasks_archived_at is created in migrate() because the column is added there
-- on existing dev databases; creating it here would crash with "no such column".
`;

/**
 * Idempotent additive migration: ALTER TABLE ADD COLUMN for any column
 * present in SCHEMA but missing from an existing tasks table. SQLite's
 * `ADD COLUMN` is instant and safe. Runs once per process startup.
 */
const ADDED_COLUMNS = [
  ["archived_at",  "INTEGER"],
  ["model",        "TEXT"],
  ["tokens_in",    "INTEGER"],
  ["tokens_out",   "INTEGER"],
  ["total_tokens", "INTEGER"],
];

const migrate = (db) => {
  const existing = new Set(db.prepare("PRAGMA table_info(tasks)").all().map((r) => r.name));
  for (const [col, type] of ADDED_COLUMNS) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${type}`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)`);
};

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
  migrate(db);
  return db;
};
