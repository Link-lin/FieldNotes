import { sql, type Kysely } from "kysely";

/**
 * A person can mark an AI draft reviewed (IMPORT-7, CONNECT-4): `reviewed_at` is when, and an AI item with it set no longer
 * shows the unverified tag. `source` keeps saying where the item came from. Only an AI item can be reviewed. A connected
 * chat's later change to the item clears it again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table plan_items
      add column reviewed_at timestamptz,
      add constraint plan_items_review_ai check (reviewed_at is null or source = 'ai')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan_items drop constraint if exists plan_items_review_ai, drop column if exists reviewed_at`.execute(db);
}
