#!/usr/bin/env node
/**
 * Delete EVERY purchase request and all child rows.
 * Destructive — use with care.
 *
 * Usage: node bin/delete-all-prs.js
 *        DB_DRIVER=postgres DATABASE_URL=... node bin/delete-all-prs.js
 */
import { config } from "../src/config.js";
import { createDatabase } from "../src/db/adapter.js";

const main = async () => {
  const dbDriver = process.env.DB_DRIVER || "sqlite";
  const db = await createDatabase(dbDriver, {
    path: config.dbPath,
    url: process.env.DATABASE_URL,
  });

  const before = await db.queryOne(`SELECT COUNT(*) AS n FROM purchase_requests`, {});
  const total = Number(before?.n ?? 0);
  if (total === 0) {
    console.log("No PRs to delete.");
    await db.close();
    return;
  }

  console.log(`Deleting ${total} PR(s) and all child rows...`);
  await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM pr_item_status_log`, {});
    await tx.execute(`DELETE FROM pr_status_log`, {});
    await tx.execute(`DELETE FROM pr_vendor_shortlist`, {});
    await tx.execute(`DELETE FROM vendor_responses`, {});
    await tx.execute(`DELETE FROM rfq_emails`, {});
    await tx.execute(`DELETE FROM pr_line_items`, {});
    await tx.execute(`DELETE FROM purchase_requests`, {});
  });

  // Also drop sourcing tasks so the agent queue is consistent with PR table.
  // metadata is JSON text; both SQLite and Postgres can do a LIKE match on it.
  const taskInfo = await db.execute(
    `DELETE FROM tasks WHERE metadata LIKE @pattern`,
    { pattern: '%"type":"sourcing"%' }
  );
  console.log(`Deleted ${taskInfo.changes ?? 0} orphan sourcing task(s).`);

  console.log("Done.");
  await db.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
