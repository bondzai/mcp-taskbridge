-- Full PostgreSQL DDL for mcp-taskbridge (core + procurement).
-- This is the single source of truth for PostgreSQL schema.
-- SQLite schema lives in src/db/sqlite-schema.js.

-- ============================================================
-- Core: tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','failed')),
  agent_id       TEXT,
  result         TEXT,
  error          TEXT,
  progress       TEXT,
  metadata       TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  claimed_at     BIGINT,
  completed_at   BIGINT,
  archived_at    BIGINT,
  model          TEXT,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  total_tokens   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at   ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_agent        ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at  ON tasks(archived_at);

-- ============================================================
-- Core: task_progress_log
-- ============================================================
CREATE TABLE IF NOT EXISTS task_progress_log (
  id          SERIAL PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  step        INTEGER,
  total_steps INTEGER,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_progress_log_task ON task_progress_log(task_id);

-- ============================================================
-- Core: task_attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS task_attachments (
  id          SERIAL PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  content     BYTEA NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_task ON task_attachments(task_id);

-- ============================================================
-- Procurement: vendors
-- ============================================================
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
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_email  ON vendors(email);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

-- ============================================================
-- Procurement: vendor_materials
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_materials (
  id               SERIAL PRIMARY KEY,
  vendor_id        TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  material_name    TEXT NOT NULL,
  category         TEXT,
  unit             TEXT,
  reference_price  REAL,
  price_updated_at BIGINT,
  min_order_qty    REAL,
  notes            TEXT,
  created_at       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_materials_vendor   ON vendor_materials(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_name     ON vendor_materials(material_name);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_category ON vendor_materials(category);

-- ============================================================
-- Procurement: purchase_requests
-- ============================================================
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
  deadline          BIGINT,
  notes             TEXT,
  sourcing_task_id  TEXT,
  analysis_task_id  TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_status        ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_created_at    ON purchase_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_pr_sourcing_task ON purchase_requests(sourcing_task_id);

-- ============================================================
-- Procurement: pr_line_items
-- ============================================================
CREATE TABLE IF NOT EXISTS pr_line_items (
  id                 SERIAL PRIMARY KEY,
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
  created_at         BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_line_items_pr ON pr_line_items(pr_id);

-- ============================================================
-- Procurement: pr_vendor_shortlist
-- ============================================================
CREATE TABLE IF NOT EXISTS pr_vendor_shortlist (
  id              SERIAL PRIMARY KEY,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id),
  line_item_id    INTEGER REFERENCES pr_line_items(id),
  reference_price REAL,
  notes           TEXT,
  rfx_types       TEXT,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_shortlist_pr     ON pr_vendor_shortlist(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_shortlist_vendor ON pr_vendor_shortlist(vendor_id);

-- ============================================================
-- Procurement: rfq_emails
-- ============================================================
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
  sent_at           BIGINT,
  delivered_at      BIGINT,
  opened_at         BIGINT,
  replied_at        BIGINT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rfq_pr     ON rfq_emails(pr_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor ON rfq_emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_emails(status);

-- ============================================================
-- Procurement: vendor_responses
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_responses (
  id              SERIAL PRIMARY KEY,
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
  valid_until     BIGINT,
  raw_text        TEXT,
  parsed_at       BIGINT NOT NULL,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_responses_rfq ON vendor_responses(rfq_id);
CREATE INDEX IF NOT EXISTS idx_vendor_responses_pr  ON vendor_responses(pr_id);

-- ============================================================
-- Procurement: pr_status_log
-- ============================================================
CREATE TABLE IF NOT EXISTS pr_status_log (
  id              SERIAL PRIMARY KEY,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT,
  reason          TEXT,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_status_log_pr ON pr_status_log(pr_id);

-- ============================================================
-- Procurement: pr_item_status_log
-- ============================================================
CREATE TABLE IF NOT EXISTS pr_item_status_log (
  id           SERIAL PRIMARY KEY,
  line_item_id INTEGER NOT NULL REFERENCES pr_line_items(id) ON DELETE CASCADE,
  pr_id        TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_by   TEXT,
  note         TEXT,
  created_at   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_log_item ON pr_item_status_log(line_item_id);
CREATE INDEX IF NOT EXISTS idx_item_log_pr   ON pr_item_status_log(pr_id);

-- Procurement: rfx_event_log
CREATE TABLE IF NOT EXISTS rfx_event_log (
  id           SERIAL PRIMARY KEY,
  rfx_id       TEXT    NOT NULL,
  pr_id        TEXT,
  vendor_id    TEXT,
  event        TEXT    NOT NULL,
  detail       TEXT,
  occurred_at  BIGINT  NOT NULL,
  received_at  BIGINT  NOT NULL,
  UNIQUE (rfx_id, event, occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_rfx_event_rfx ON rfx_event_log(rfx_id);
CREATE INDEX IF NOT EXISTS idx_rfx_event_pr  ON rfx_event_log(pr_id);

-- Procurement: rfx_send_log (internal debug — clean later)
CREATE TABLE IF NOT EXISTS rfx_send_log (
  id              SERIAL PRIMARY KEY,
  rfx_id          TEXT NOT NULL,
  pr_id           TEXT,
  vendor_id       TEXT,
  ok              INTEGER NOT NULL,
  mock            INTEGER NOT NULL,
  status_code     INTEGER,
  response_body   TEXT,
  error           TEXT,
  request_summary TEXT,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfx_send_log_rfx ON rfx_send_log(rfx_id);
CREATE INDEX IF NOT EXISTS idx_rfx_send_log_pr  ON rfx_send_log(pr_id);

-- ============================================================
-- Idempotent column-additive migrations.
-- CREATE TABLE IF NOT EXISTS doesn't add columns to an existing table,
-- so any column added after the initial deploy must be re-applied here
-- via ADD COLUMN IF NOT EXISTS on every startup.
-- ============================================================
ALTER TABLE pr_vendor_shortlist ADD COLUMN IF NOT EXISTS rfx_types TEXT;
ALTER TABLE pr_line_items       ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE pr_line_items       ADD COLUMN IF NOT EXISTS selected_vendor_id TEXT;
ALTER TABLE pr_line_items       ADD COLUMN IF NOT EXISTS selected_price NUMERIC(12,2);
ALTER TABLE pr_line_items       ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE pr_line_items       ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE tasks               ADD COLUMN IF NOT EXISTS metadata TEXT;
