import { sql, type Kysely } from "kysely";

/**
 * A trip's creator may leave: deleting their account no longer deletes trips that other owners keep.
 * `owner_user_id` becomes nullable and its foreign key `ON DELETE SET NULL`. Account deletion settles each
 * trip first (it stays with another owner, goes to an owner the leaving person chooses, or is deleted), so a
 * trip never ends up with nobody who can manage it.
 *
 * No rollback: restoring NOT NULL would mean deleting or reassigning the trips whose creator has left.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table trips alter column owner_user_id drop not null`.execute(db);
  await sql`alter table trips drop constraint trips_owner_user_id_fkey`.execute(db);
  await sql`
    alter table trips
      add constraint trips_owner_user_id_fkey foreign key (owner_user_id) references "User"(id) on delete set null
  `.execute(db);
}
