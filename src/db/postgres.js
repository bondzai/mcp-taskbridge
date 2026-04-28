import postgres from "postgres";

/**
 * PostgreSQL adapter wrapping postgres.js with the same interface as the
 * SQLite adapter. Named params (`@id`, `@name`) in SQL strings are
 * converted to positional (`$1`, `$2`) before execution.
 */
export const createPostgresAdapter = (connectionString) => {
  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  /**
   * Convert named params (`@key`) to positional (`$N`) and build values array.
   * The same key may appear multiple times; each occurrence gets its own
   * positional slot so the query plan stays simple.
   */
  const toPositional = (query, params) => {
    const keys = [];
    const positional = query.replace(/@(\w+)/g, (_, key) => {
      keys.push(key);
      return `$${keys.length}`;
    });
    return { text: positional, values: keys.map((k) => params[k]) };
  };

  const makeAdapter = (client) => ({
    driver: "postgres",

    async query(sqlStr, params = {}) {
      if (Object.keys(params).length === 0) return client.unsafe(sqlStr);
      const { text, values } = toPositional(sqlStr, params);
      return client.unsafe(text, values);
    },

    async queryOne(sqlStr, params = {}) {
      const rows = await this.query(sqlStr, params);
      return rows[0] || null;
    },

    async execute(sqlStr, params = {}) {
      const rows = await this.query(sqlStr, params);
      return {
        changes: rows.count ?? rows.length ?? 0,
        lastId: rows[0]?.id ?? null,
      };
    },

    async transaction(fn) {
      return client.begin(async (tx) => fn(makeAdapter(tx)));
    },

    async exec(ddl) {
      await client.unsafe(ddl);
    },

    async close() {
      await client.end();
    },
  });

  return makeAdapter(sql);
};
