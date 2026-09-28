/**
 * Apply database migrations. Uses MIGRATION_DATABASE_URL (schema-owner credential)
 * when set, otherwise DATABASE_URL. The app's runtime role should not run DDL.
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { migrateToLatest } from "../db/migrate";
import { describeDbError } from "./db-error";
import { loadEnvFile } from "./env-file";

loadEnvFile();
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or MIGRATION_DATABASE_URL) first. See .env.example.");
  process.exit(1);
}
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }) });
try {
  const applied = await migrateToLatest(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} catch (err) {
  console.error("Migration failed:", describeDbError(err));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
