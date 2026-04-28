/**
 * Database adapter factory.
 *
 * Returns a driver-specific adapter that implements a unified async interface:
 *
 *   query(sql, params)      → Promise<Row[]>
 *   queryOne(sql, params)   → Promise<Row | null>
 *   execute(sql, params)    → Promise<{ changes, lastId }>
 *   transaction(fn)         → Promise<T>
 *   exec(ddl)               → Promise<void>
 *   close()                 → Promise<void>
 *
 * Params are always named objects ({ id, name, status }).
 * - SQLite: better-sqlite3 natively supports @id, @name
 * - PostgreSQL: adapter converts @name → $N positional params
 *
 * @param {"sqlite"|"postgres"} driver
 * @param {{ path?: string, url?: string }} config
 */
export const createDatabase = async (driver, config = {}) => {
  if (driver === "postgres") {
    const { createPostgresAdapter } = await import("./postgres.js");
    return createPostgresAdapter(config.url);
  }

  const { createSqliteAdapter } = await import("./sqlite.js");
  return createSqliteAdapter(config.path || ":memory:");
};
