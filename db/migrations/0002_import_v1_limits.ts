import { sql, type Kysely } from "kysely";

/**
 * JSON import v1 permits longer flight details and three- or four-character airport codes.
 * Widen the original checks without rewriting existing rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table trips
      drop constraint trips_time_zone_check,
      add constraint trips_time_zone_check check (char_length(time_zone) between 1 and 100);

    alter table plan_items
      drop constraint plan_items_time_zone_check,
      drop constraint plan_items_airline_check,
      drop constraint plan_items_flight_number_check,
      drop constraint plan_items_departure_airport_code_check,
      drop constraint plan_items_departure_time_zone_check,
      drop constraint plan_items_arrival_airport_code_check,
      drop constraint plan_items_arrival_time_zone_check,
      add constraint plan_items_time_zone_check check (char_length(time_zone) <= 100),
      add constraint plan_items_airline_check check (char_length(airline) <= 120),
      add constraint plan_items_flight_number_check check (char_length(flight_number) <= 24),
      add constraint plan_items_departure_airport_code_check check (departure_airport_code ~ '^[A-Z0-9]{3,4}$'),
      add constraint plan_items_departure_time_zone_check check (char_length(departure_time_zone) <= 100),
      add constraint plan_items_arrival_airport_code_check check (arrival_airport_code ~ '^[A-Z0-9]{3,4}$'),
      add constraint plan_items_arrival_time_zone_check check (char_length(arrival_time_zone) <= 100);
  `.execute(db);
}

/**
 * The old checks validate existing data before the migration rolls back. A rollback with
 * v1-length values fails safely instead of truncating owner data.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table trips
      drop constraint trips_time_zone_check,
      add constraint trips_time_zone_check check (char_length(time_zone) between 1 and 64);

    alter table plan_items
      drop constraint plan_items_time_zone_check,
      drop constraint plan_items_airline_check,
      drop constraint plan_items_flight_number_check,
      drop constraint plan_items_departure_airport_code_check,
      drop constraint plan_items_departure_time_zone_check,
      drop constraint plan_items_arrival_airport_code_check,
      drop constraint plan_items_arrival_time_zone_check,
      add constraint plan_items_time_zone_check check (char_length(time_zone) <= 64),
      add constraint plan_items_airline_check check (char_length(airline) <= 80),
      add constraint plan_items_flight_number_check check (char_length(flight_number) <= 16),
      add constraint plan_items_departure_airport_code_check check (departure_airport_code ~ '^[A-Z]{3}$'),
      add constraint plan_items_departure_time_zone_check check (char_length(departure_time_zone) <= 64),
      add constraint plan_items_arrival_airport_code_check check (arrival_airport_code ~ '^[A-Z]{3}$'),
      add constraint plan_items_arrival_time_zone_check check (char_length(arrival_time_zone) <= 64);
  `.execute(db);
}
