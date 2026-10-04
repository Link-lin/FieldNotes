import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";

/** Adds to today's (database date) totals, one row per name. */
export async function addUsage(db: Kysely<DB>, counts: Map<string, number>): Promise<void> {
  const values = [...counts.entries()].filter(([, n]) => n > 0).map(([name, count]) => ({ day: sql<string>`current_date`, name, count }));
  if (!values.length) return;
  await db
    .insertInto("usage_counts")
    .values(values as never)
    .onConflict((oc) => oc.columns(["day", "name"]).doUpdateSet({ count: sql`usage_counts.count + excluded.count` }))
    .execute();
}
