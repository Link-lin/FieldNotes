import { sql, type Kysely } from "kysely";

/**
 * Roles for people a trip is shared with: viewer (read), editor (also changes events and bookings) or
 * owner (also changes the trip, shares it and deletes it). Existing entries were all viewers, which is
 * the default, so nothing changes for them. The table keeps its name; it now holds every member.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table trip_viewers
      add column role text not null default 'viewer' check (role in ('viewer', 'editor', 'owner'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Editors and co-owners would become viewers; removing the column loses only their role, not their access.
  await sql`alter table trip_viewers drop column if exists role;`.execute(db);
}
