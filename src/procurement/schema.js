export const PROCUREMENT_SCHEMA = `
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
CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors(email);
CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

CREATE TABLE IF NOT EXISTS vendor_materials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  material_name   TEXT NOT NULL,
  category        TEXT,
  unit            TEXT,
  reference_price REAL,
  price_updated_at INTEGER,
  min_order_qty   REAL,
  notes           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_vendor ON vendor_materials(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_name ON vendor_materials(material_name);
CREATE INDEX IF NOT EXISTS idx_vendor_materials_category ON vendor_materials(category);

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
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_created_at ON purchase_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_pr_sourcing_task ON purchase_requests(sourcing_task_id);

CREATE TABLE IF NOT EXISTS pr_line_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  material_name   TEXT NOT NULL,
  specification   TEXT,
  quantity        REAL NOT NULL,
  unit            TEXT NOT NULL,
  notes           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_line_items_pr ON pr_line_items(pr_id);

CREATE TABLE IF NOT EXISTS pr_vendor_shortlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id           TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id),
  line_item_id    INTEGER REFERENCES pr_line_items(id),
  reference_price REAL,
  notes           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_shortlist_pr ON pr_vendor_shortlist(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_shortlist_vendor ON pr_vendor_shortlist(vendor_id);

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
CREATE INDEX IF NOT EXISTS idx_rfq_pr ON rfq_emails(pr_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor ON rfq_emails(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rfq_status ON rfq_emails(status);

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
CREATE INDEX IF NOT EXISTS idx_vendor_responses_pr ON vendor_responses(pr_id);

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
CREATE INDEX IF NOT EXISTS idx_item_log_pr ON pr_item_status_log(pr_id);
`;

export const migrateProcurement = (db) => {
  db.exec(PROCUREMENT_SCHEMA);

  // Idempotent column additions for item-level statuses
  const addCol = (table, col, type, dflt) => {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
    if (!cols.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}${dflt != null ? ` DEFAULT ${dflt}` : ""}`);
    }
  };
  addCol("pr_line_items", "status", "TEXT", "'draft'");
  addCol("pr_line_items", "selected_vendor_id", "TEXT", null);
  addCol("pr_line_items", "selected_price", "REAL", null);
  addCol("pr_line_items", "po_number", "TEXT", null);
  addCol("pr_line_items", "note", "TEXT", null);
};
