#!/usr/bin/env node
/**
 * Seed N realistic mock Purchase Requisitions.
 *
 *   # against local sqlite (or whatever DB_DRIVER points at):
 *   node bin/mock-prs.js --count 10
 *
 *   # against the deployed Cloud Run service via HTTP API:
 *   node bin/mock-prs.js --count 10 \
 *        --http https://procurement-core-1087425769327.asia-southeast1.run.app \
 *        --user admin --pass admin
 *
 *   # use OpenAI for richer / more varied mock data:
 *   OPENAI_API_KEY=sk-... node bin/mock-prs.js --count 10 --llm
 *   OPENAI_API_KEY=sk-... node bin/mock-prs.js --count 5 --llm --industry "biotech R&D"
 *
 * Flags:
 *   --count <N>       number of PRs to create (default 5)
 *   --http <baseUrl>  use HTTP API instead of direct DB
 *   --user <name>     auth username for HTTP mode (default admin)
 *   --pass <pwd>      auth password for HTTP mode (default admin)
 *   --seed <int>      deterministic RNG seed (offline generator only)
 *   --llm             generate via LLM provider (uses src/llm/provider.js)
 *   --industry <hint> industry/domain hint for LLM mode (optional)
 */
import { generateMockPrs } from "../src/procurement/mock-prs.js";
import { createLlmProvider } from "../src/llm/provider.js";

const parseArgs = (argv) => {
  const args = { count: 5, http: null, user: "admin", pass: "admin", seed: null, llm: false, industry: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--count") args.count = Number(next()) || 5;
    else if (a === "--http") args.http = next();
    else if (a === "--user") args.user = next();
    else if (a === "--pass") args.pass = next();
    else if (a === "--seed") args.seed = Number(next());
    else if (a === "--llm") args.llm = true;
    else if (a === "--industry") args.industry = next();
  }
  return args;
};

// Tiny deterministic PRNG when --seed is given; Math.random otherwise.
const makeRng = (seed) => {
  if (seed == null) return Math.random;
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const seedViaDb = async (prs) => {
  const { config } = await import("../src/config.js");
  const { createDatabase } = await import("../src/db/adapter.js");
  const { createPurchaseRequestsRepository, createStatusLogRepository } =
    await import("../src/procurement/repo.js");

  const dbDriver = process.env.DB_DRIVER || "sqlite";
  const db = await createDatabase(dbDriver, {
    path: config.dbPath,
    url: process.env.DATABASE_URL,
  });

  const pr = createPurchaseRequestsRepository(db);
  const log = createStatusLogRepository(db);
  let ok = 0;
  for (const p of prs) {
    const created = await pr.insertWithItems(p.title, p.requestedBy, p.deadline, p.notes, p.lineItems);
    await log.insert(created.id, null, "pending_approval", p.requestedBy, null);
    console.log(`✔ ${created.id}  ${p.title}  (${p.lineItems.length} items)`);
    ok++;
  }
  await db.close();
  return ok;
};

const seedViaHttp = async (prs, { baseUrl, user, pass }) => {
  // Login → cookie jar (we use one shared Set-Cookie value)
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const cookie = loginRes.headers.get("set-cookie");
  if (!cookie) throw new Error("no set-cookie in login response");
  const sessionCookie = cookie.split(";")[0]; // tb_session=...

  let ok = 0;
  for (const p of prs) {
    const res = await fetch(`${baseUrl}/api/procurement/prs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify(p),
    });
    if (!res.ok) {
      console.error(`✗ ${p.title}: ${res.status} ${await res.text()}`);
      continue;
    }
    const body = await res.json();
    console.log(`✔ ${body.id}  ${p.title}  (${p.lineItems.length} items)`);
    ok++;
  }
  return ok;
};

const generateBatch = async (args) => {
  if (!args.llm) {
    return generateMockPrs({ count: args.count, rng: makeRng(args.seed) });
  }
  const provider = await createLlmProvider();
  console.log(`Asking ${provider.name} (${provider.model}) for ${args.count} PR(s)…`);
  const prs = await provider.generatePrs({ count: args.count, industryHint: args.industry });
  if (prs.length === 0) throw new Error("LLM returned no PRs");
  if (prs.length < args.count) {
    console.warn(`LLM returned ${prs.length} of ${args.count} requested.`);
  }
  // Backfill missing fields with sane defaults so the API accepts them.
  return prs.map((p) => ({
    title: p.title || "Untitled PR",
    requestedBy: p.requestedBy || "demo.user",
    deadline: typeof p.deadline === "number" ? p.deadline : null,
    notes: p.notes ?? null,
    lineItems: (p.lineItems || []).filter((i) => i?.materialName && i.quantity).map((i) => ({
      materialName: i.materialName,
      specification: i.specification ?? null,
      quantity: Number(i.quantity) || 1,
      unit: i.unit || "unit",
    })),
  })).filter((p) => p.lineItems.length > 0);
};

const main = async () => {
  const args = parseArgs(process.argv);
  const prs = await generateBatch(args);

  console.log(`Generated ${prs.length} mock PR(s) (${args.llm ? "LLM" : "offline"}) → ${args.http ? args.http : "local DB"}`);
  const ok = args.http
    ? await seedViaHttp(prs, { baseUrl: args.http.replace(/\/+$/, ""), user: args.user, pass: args.pass })
    : await seedViaDb(prs);

  console.log(`\nDone. ${ok}/${prs.length} created.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
