import { sql, type Kysely } from "kysely";

/**
 * Invitations by link. Someone without a Google address (a WeChat contact, say) can't be invited by email, so an
 * entry can carry a label the owner chose instead of an address: whoever opens its single-use link first joins.
 * An entry has exactly one of the two. The unique (trip, email) constraint is unchanged; NULLs never collide, so a
 * trip can hold any number of link entries.
 *
 * No rollback: dropping the column would delete the link entries.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table trip_viewers alter column invitee_email_normalized drop not null`.execute(db);
  await sql`
    alter table trip_viewers
      add column label text check (label is null or (char_length(label) between 1 and 80 and label = btrim(label)))
  `.execute(db);
  await sql`
    alter table trip_viewers
      add constraint trip_viewers_email_or_label check ((invitee_email_normalized is null) <> (label is null))
  `.execute(db);
}
