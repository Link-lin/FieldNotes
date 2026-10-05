import { Migrator, type Kysely, type Migration, type MigrationProvider } from "kysely";
import * as m0001 from "./migrations/0001_initial";
import * as m0002 from "./migrations/0002_import_v1_limits";
import * as m0003 from "./migrations/0003_usage_counts";
import * as m0004 from "./migrations/0004_member_roles";
import * as m0005 from "./migrations/0005_creator_may_leave";
import * as m0006 from "./migrations/0006_accounts_without_email";
import * as m0007 from "./migrations/0007_link_invitations";
import * as m0008 from "./migrations/0008_ai_connector";
import * as m0009 from "./migrations/0009_item_review";
import * as m0010 from "./migrations/0010_auto_pins";

/** Migrations are listed explicitly so every runtime (tsx, tests) sees the same set. */
const migrations: Record<string, Migration> = {
  "0001_initial": m0001,
  "0002_import_v1_limits": m0002,
  "0003_usage_counts": m0003,
  "0004_member_roles": m0004,
  "0005_creator_may_leave": m0005,
  "0006_accounts_without_email": m0006,
  "0007_link_invitations": m0007,
  "0008_ai_connector": m0008,
  "0009_item_review": m0009,
  "0010_auto_pins": m0010,
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
