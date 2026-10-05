import { sql, type Kysely } from "kysely";

/**
 * MAP-2: an event's pin can come from an automatic place lookup of its place name, when the lookup finds one clear match.
 * `pin_source = 'lookup'` marks such a pin (stored, like any other, as a map link with coordinates); null means the link is
 * one a person saved or chose. An automatic pin belongs to the place name it was found for, so changing the name drops it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table plan_items
      add column pin_source text,
      add constraint plan_items_pin_source check (pin_source is null or (pin_source = 'lookup' and map_url is not null and latitude is not null))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plan_items drop constraint if exists plan_items_pin_source, drop column if exists pin_source`.execute(db);
}
