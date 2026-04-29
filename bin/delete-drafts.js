#!/usr/bin/env node
/**
 * Delete every PR with status='draft' (and its child rows).
 * Run once after upgrading past the "drafts removed" change.
 *
 * Usage: node bin/delete-drafts.js
 *        DB_DRIVER=postgres DATABASE_URL=... node bin/delete-drafts.js
 */
import { config } from "../src/config.js";
import { createDatabase } from "../src/db/adapter.js";

const main = async () => {
  const dbDriver = process.env.DB_DRIVER || "sqlite";
  const db = await createDatabase(dbDriver, {
    path: config.dbPath,
    url: process.env.DATABASE_URL,
  });

  const drafts = await db.query(
    `SELECT id, title FROM purchase_requests WHERE status = @s`,
    { s: "draft" }
  );

  if (drafts.length === 0) {
    console.log("No draft PRs found.");
    await db.close();
    return;
  }

  console.log(`Deleting ${drafts.length} draft PR(s):`);
  for (const d of drafts) console.log(`  - ${d.id}  ${d.title}`);

  for (const d of drafts) {
    await db.transaction(async (tx) => {
      await tx.execute(`DELETE FROM pr_item_status_log WHERE pr_id = @id`, { id: d.id });
      await tx.execute(`DELETE FROM rfq_emails WHERE pr_id = @id`, { id: d.id });
      await tx.execute(`DELETE FROM vendor_responses WHERE pr_id = @id`, { id: d.id });
      await tx.execute(`DELETE FROM purchase_requests WHERE id = @id`, { id: d.id });
    });
  }

  console.log("Done.");
  await db.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
