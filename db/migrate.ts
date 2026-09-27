import { Migrator, type Kysely, type Migration, type MigrationProvider } from "kysely";
import * as m0001 from "./migrations/0001_initial";

/** Migrations are listed explicitly so every runtime (tsx, tests) sees the same set. */
const migrations: Record<string, Migration> = {
  "0001_initial": m0001,
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

export async function migrateToLatest(db: Kysely<unknown>): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  const applied = (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
  const failed = (results ?? []).find((r) => r.status === "Error");
  if (error || failed) throw error instanceof Error ? error : new Error(`Migration failed: ${failed?.migrationName ?? "unknown"}`);
  return applied;
}
