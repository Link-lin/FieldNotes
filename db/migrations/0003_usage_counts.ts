import { sql, type Kysely } from "kysely";

/**
 * Pilot measures (PRD: Validation and MVP acceptance): daily totals per named action. No user, trip or content
 * column exists, so the table holds nothing personal and nothing to delete with an account.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table usage_counts (
      day date not null,
      name text not null check (name ~ '^[a-z_]{1,64}$'),
      count bigint not null default 0 check (count >= 0),
      primary key (day, name)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists usage_counts;`.execute(db);
}
