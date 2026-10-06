import { sql, type Kysely } from "kysely";

/**
 * `is_copy` marks an event made with Duplicate (PLAN-3). A person's copy of an AI item keeps its provenance tags, but it
 * isn't AI output, so the pilot's AI item counts leave it out. Events copied before this column existed read as originals.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan_items add column is_copy boolean not null default false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan_items drop column if exists is_copy`.execute(db);
}
