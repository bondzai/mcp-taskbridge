import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite adapter wrapping better-sqlite3 with an async interface.
 *
 * better-sqlite3 is synchronous, but we return resolved promises so the
 * repository layer can be driver-agnostic (same code works with PostgreSQL).
 *
 * TRANSACTION CONSTRAINT: transaction bodies must only perform DB operations
 * via the adapter — no external async I/O. SQLite transactions are
 * synchronous under the hood; the BEGIN/COMMIT wrapper tolerates `await`
 * on the sync return values (which resolve immediately) but would break
 * if the body yielded to truly async work between statements.
 */
export const createSqliteAdapter = (filePath) => {
  // Ensure directory exists
  if (filePath !== ":memory:") {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  const stmtCache = new Map();
  const prepare = (sql) => {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  };

  const adapter = {
    driver: "sqlite",

    async query(sql, params = {}) {
      return prepare(sql).all(params);
    },

    async queryOne(sql, params = {}) {
      return prepare(sql).get(params) || null;
    },

    async execute(sql, params = {}) {
      const info = prepare(sql).run(params);
      return { changes: info.changes, lastId: Number(info.lastInsertRowid) };
    },

    /**
     * Run `fn` inside a SQLite transaction.
     *
     * We use explicit BEGIN / COMMIT / ROLLBACK rather than
     * `db.transaction()` so that `fn` can be an async function whose body
     * `await`s the adapter's (synchronously-resolved) promises.
     *
     * `fn` receives `this` adapter — all calls between BEGIN and COMMIT
     * are automatically part of the transaction.
     */
    async transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = await fn(adapter);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    async exec(ddl) {
      db.exec(ddl);
    },

    async close() {
      db.close();
    },
  };

  return adapter;
};
