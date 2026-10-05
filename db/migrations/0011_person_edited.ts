import { sql, type Kysely } from "kysely";

/**
 * Pilot measure (PRD: Validation and MVP acceptance): `person_edited_at` is when a person first changed an AI item
 * (imported, or added by a connected chat), so the pilot counts how many AI items people correct rather than how many
 * saves they make. Only an AI item has it; a connected chat's own changes never set it. An AI item changed before this
 * column existed counts as first changed on its next change.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table plan_items
      add column person_edited_at timestamptz,
      add constraint plan_items_person_edited_ai check (person_edited_at is null or source = 'ai')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan_items drop constraint if exists plan_items_person_edited_ai, drop column if exists person_edited_at`.execute(db);
}
