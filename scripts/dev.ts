/**
 * `npm run dev`: one command for local development. Starts the embedded database when
 * DATABASE_URL points at it and nothing is listening yet, applies pending migrations, then runs
 * `next dev` (extra arguments are passed through). Stopping the app stops a database it started.
 * Production keeps the separate `npm run db:migrate` step (technical design section 12).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type EmbeddedPostgres from "embedded-postgres";
import { migrateToLatest } from "../db/migrate";
import { describeDbError } from "./db-error";
import { loadEnvFile } from "./env-file";
import { isListening, isLocalDbUrl, localDbPort, startLocalDb, stopLocalDb } from "./local-db";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local first. See .env.example.");
  process.exit(1);
}

let server: EmbeddedPostgres | null = null;
const port = localDbPort();
if (isLocalDbUrl(url, port) && !(await isListening(port))) {
  console.log(`Starting the local database on port ${port}…`);
  server = await startLocalDb(port, { quiet: true });
}

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL || url, max: 1 }) }),
});
try {
  const applied = await migrateToLatest(db);
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date.");
} catch (err) {
  console.error("Migration failed:", describeDbError(err));
  await db.destroy();
  if (server) await stopLocalDb(server);
  process.exit(1);
}
await db.destroy();

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const app = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], { stdio: "inherit" });

// Ctrl+C reaches the app directly (same terminal); wait for it to exit, then stop the database.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => app.kill("SIGTERM"));
app.on("exit", async (code, signal) => {
  if (server) {
    console.log("Stopping the local database…");
    await stopLocalDb(server);
  }
  process.exit(code ?? (signal ? 1 : 0));
});
