/**
 * Pilot report (PRD section 8): prints the daily pilot counts as totals, rates and weekly
 * figures. The counts hold no user, trip or content data. Uses DATABASE_URL.
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "../src/server/core/db/schema";
import { summarizeUsage, type UsageRow } from "../src/server/modules/usage/usage.rules";
import { describeDbError } from "./db-error";
import { loadEnvFile } from "./env-file";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first. See .env.example.");
  process.exit(1);
}
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }) });
try {
  const rows: UsageRow[] = await db.selectFrom("usage_counts").select(["day", "name", "count"]).orderBy("day").execute();
  const s = summarizeUsage(rows);
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(rows.length ? `Pilot counts from ${rows[0]!.day} to ${rows[rows.length - 1]!.day}\n` : "No pilot counts yet.\n");
  console.log("Totals");
  for (const [name, n] of Object.entries(s.totals)) console.log(`  ${name.padEnd(28)} ${n}`);
  console.log("\nRates");
  console.log(`  Previews needing no fixes      ${pct(s.rates.cleanPreview)}`);
  console.log(`  Previews rejected (bad JSON)   ${pct(s.rates.rejectedPreview)}`);
  console.log(`  Items skipped in preview       ${pct(s.rates.skippedItems)}`);
  console.log(`  Edits per imported item        ${s.rates.editsPerImportedItem ?? "n/a"}`);
  if (s.weeks.length) {
    console.log("\nBy week (Monday)");
    for (const w of s.weeks) console.log(`  ${w.week}  ${Object.entries(w.counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
} catch (err) {
  console.error("Report failed:", describeDbError(err));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
