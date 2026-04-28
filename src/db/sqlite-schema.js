/**
 * Combined SQLite schema for mcp-taskbridge (core + procurement).
 *
 * This merges the DDL previously split across src/core/db.js and
 * src/procurement/schema.js into a single CREATE-IF-NOT-EXISTS script,
 * plus an idempotent migration function for columns added after the
 * initial release.
 */

export const SQLITE_SCHEMA = `
-- -------------------------------------------------------
-- Core: tasks
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed')),
  agent_id       TEXT,
  result         TEXT,
  error          TEXT,
  progress       TEXT,
  metadata       TEXT,
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

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at   ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_agent        ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at  ON tasks(archived_at);

-- -------------------------------------------------------
-- Core: task_progress_log
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_progress_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  step        INTEGER,
  total_steps INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_progress_log_task ON task_progress_log(task_id);

-- -------------------------------------------------------
-- Core: task_attachments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  content     BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_task ON task_attachments(task_id);

-- -------------------------------------------------------
-- Procurement: vendors
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  address         TEXT,
  categories      TEXT,
  lead_time_days  INTEGER,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  active          INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_email  ON vendors(email);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

-- -------------------------------------------------------
-- Procurement: vendor_materials
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_materials (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id        TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  material_name    TEXT NOT NULL,
  category         TEXT,
  unit             TEXT,
  reference_price  REAL,
  price_updated_at INTEGER,
  min_order_qty    REAL,
  notes            TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_materials_vendor   ON vendor_materials(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_name     ON vendor_materials(material_name);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_category ON vendor_materials(category);

-- -------------------------------------------------------
-- Procurement: purchase_requests
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requests (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
    'draft','pending_approval','pending',
    'processing','failed','completed','cancelled'
  )),
  requested_by      TEXT,
  approved_by       TEXT,
  rejected_reason   TEXT,
  deadline          INTEGER,
  notes             TEXT,
  sourcing_task_id  TEXT,
  analysis_task_id  TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_status        ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_created_at    ON purchase_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_pr_sourcing_task ON purchase_requests(sourcing_task_id);

-- -------------------------------------------------------
-- Procurement: pr_line_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pr_line_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id              TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  material_name      TEXT NOT NULL,
  specification      TEXT,
  quantity           REAL NOT NULL,
  unit               TEXT NOT NULL,
  notes              TEXT,
  status             TEXT DEFAULT 'draft',
  selected_vendor_id TEXT,
  selected_price     REAL,
  po_number          TEXT,
  note               TEXT,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_line_items_pr ON pr_line_items(pr_id);

-- -------------------------------------------------------
-- Procurement: pr_vendor_shortlist
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pr_vendor_shortlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id),
  line_item_id    INTEGER REFERENCES pr_line_items(id),
  reference_price REAL,
  notes           TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_shortlist_pr     ON pr_vendor_shortlist(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_shortlist_vendor ON pr_vendor_shortlist(vendor_id);

-- -------------------------------------------------------
-- Procurement: rfq_emails
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfq_emails (
  id                TEXT PRIMARY KEY,
  pr_id             TEXT NOT NULL REFERENCES purchase_requests(id),
  vendor_id         TEXT NOT NULL REFERENCES vendors(id),
  to_email          TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
    'pending','sending','sent','send_failed','delivered','opened','replied','expired'
  )),
  gmail_thread_id   TEXT,
  gmail_message_id  TEXT,
  line_item_ids     TEXT,
  sent_at           INTEGER,
  delivered_at      INTEGER,
  opened_at         INTEGER,
  replied_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rfq_pr     ON rfq_emails(pr_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor ON rfq_emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_emails(status);

-- -------------------------------------------------------
-- Procurement: vendor_responses
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_responses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id          TEXT NOT NULL REFERENCES rfq_emails(id),
  pr_id           TEXT,
  vendor_id       TEXT,
  line_item_id    INTEGER,
  unit_price      REAL,
  total_price     REAL,
  lead_time_days  INTEGER,
  min_order_qty   REAL,
  availability    TEXT,
  currency        TEXT,
  valid_until     INTEGER,
  raw_text        TEXT,
  parsed_at       INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_responses_rfq ON vendor_responses(rfq_id);
CREATE INDEX IF NOT EXISTS idx_vendor_responses_pr  ON vendor_responses(pr_id);

-- -------------------------------------------------------
-- Procurement: pr_status_log
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pr_status_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT,
  reason          TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_status_log_pr ON pr_status_log(pr_id);

-- -------------------------------------------------------
-- Procurement: pr_item_status_log
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pr_item_status_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id INTEGER NOT NULL REFERENCES pr_line_items(id) ON DELETE CASCADE,
  pr_id        TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_by   TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_log_item ON pr_item_status_log(line_item_id);
CREATE INDEX IF NOT EXISTS idx_item_log_pr   ON pr_item_status_log(pr_id);
`;

/**
 * Idempotent additive migration for SQLite databases created before all
 * columns existed.  Safe to run on every startup — ALTER TABLE ADD COLUMN
 * is a no-op if the column already exists (we check first).
 */
export const migrateSqlite = async (db) => {
  const addColIfMissing = async (table, col, type, dflt) => {
    const cols = await db.query(`PRAGMA table_info(${table})`);
    if (!cols.some((r) => r.name === col)) {
      const defaultClause = dflt != null ? ` DEFAULT ${dflt}` : "";
      await db.exec(
        `ALTER TABLE ${table} ADD COLUMN ${col} ${type}${defaultClause}`,
      );
    }
  };

  // Core: tasks columns added after initial schema
  await addColIfMissing("tasks", "archived_at", "INTEGER");
  await addColIfMissing("tasks", "model", "TEXT");
  await addColIfMissing("tasks", "tokens_in", "INTEGER");
  await addColIfMissing("tasks", "tokens_out", "INTEGER");
  await addColIfMissing("tasks", "total_tokens", "INTEGER");
  await addColIfMissing("tasks", "metadata", "TEXT");

  // Procurement: pr_line_items columns added for item-level statuses
  await addColIfMissing("pr_line_items", "status", "TEXT", "'draft'");
  await addColIfMissing("pr_line_items", "selected_vendor_id", "TEXT", null);
  await addColIfMissing("pr_line_items", "selected_price", "REAL", null);
  await addColIfMissing("pr_line_items", "po_number", "TEXT", null);
  await addColIfMissing("pr_line_items", "note", "TEXT", null);
};
