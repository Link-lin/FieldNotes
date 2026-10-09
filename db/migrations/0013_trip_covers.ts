import { sql, type Kysely } from "kysely";

/**
 * DASH-8: a trip's cover image. `trips` holds what every screen needs (the stored image's SHA-256 and its size, all or
 * nothing); `trip_covers` holds the two JPEGs, so trip and dashboard queries never load the bytes. The cover service
 * writes both in one transaction, and deleting the trip deletes its cover.
 *
 * No rollback: dropping them would delete every cover.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table trips
      add column cover_hash text,
      add column cover_width integer,
      add column cover_height integer,
      add constraint trips_cover check (
        (cover_hash is null and cover_width is null and cover_height is null)
        or (cover_hash is not null and cover_width is not null and cover_height is not null
          and cover_hash ~ '^[0-9a-f]{64}$' and cover_width between 1 and 2048 and cover_height between 1 and 2048)
      )
  `.execute(db);
  await sql`
    create table trip_covers (
      trip_id uuid primary key references trips(id) on delete cascade,
      full_jpeg bytea not null check (octet_length(full_jpeg) between 4 and 1048576),
      small_jpeg bytea not null check (octet_length(small_jpeg) between 4 and 1048576),
      created_at timestamptz not null default now()
    )
  `.execute(db);
}
