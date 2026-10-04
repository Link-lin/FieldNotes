import { sql, type Kysely } from "kysely";

/**
 * A person can sign in without an email address: WeChat gives none. `User.email` becomes optional. Its unique
 * constraint stays, and Postgres lets any number of rows hold NULL. Email still decides the owner allowlist and
 * email invitations, so an account without one can be given any role on a trip but cannot create trips.
 *
 * No rollback: restoring NOT NULL would mean inventing an address for each such account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table "User" alter column email drop not null`.execute(db);
}
