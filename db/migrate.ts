import { Migrator, type Kysely, type Migration, type MigrationProvider } from "kysely";
import * as m0001 from "./migrations/0001_initial";
import * as m0002 from "./migrations/0002_import_v1_limits";
import * as m0003 from "./migrations/0003_usage_counts";
import * as m0004 from "./migrations/0004_member_roles";
import * as m0005 from "./migrations/0005_creator_may_leave";

/** Migrations are listed explicitly so every runtime (tsx, tests) sees the same set. */
const migrations: Record<string, Migration> = {
  "0001_initial": m0001,
  "0002_import_v1_limits": m0002,
  "0003_usage_counts": m0003,
  "0004_member_roles": m0004,
  "0005_creator_may_leave": m0005,
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
