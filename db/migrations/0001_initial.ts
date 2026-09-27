import { sql, type Kysely } from "kysely";

/**
 * Initial schema (technical design section 4). Auth.js tables keep the adapter's
 * default names and camel-case columns; app tables use snake_case.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table "User" (
      id uuid primary key default gen_random_uuid(),
      name text,
      email text not null unique,
      "emailVerified" timestamptz,
      image text
    );

    create table "Account" (
      id uuid primary key default gen_random_uuid(),
      "userId" uuid not null references "User"(id) on delete cascade,
      type text not null,
      provider text not null,
      "providerAccountId" text not null,
      refresh_token text,
      access_token text,
      expires_at bigint,
      token_type text,
      scope text,
      id_token text,
      session_state text,
      unique (provider, "providerAccountId")
    );
    create index account_user on "Account"("userId");

    create table "Session" (
      id uuid primary key default gen_random_uuid(),
      "userId" uuid not null references "User"(id) on delete cascade,
      "sessionToken" text not null unique,
      expires timestamptz not null
    );
    create index session_user on "Session"("userId");

    create table "VerificationToken" (
      identifier text not null,
      token text not null unique,
      expires timestamptz not null,
      primary key (identifier, token)
    );

    create table trips (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null references "User"(id) on delete cascade,
      title text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
      destination text not null check (char_length(destination) between 1 and 160 and destination = btrim(destination)),
      atlas_latitude numeric(8,5) check (atlas_latitude between -90 and 90),
      atlas_longitude numeric(8,5) check (atlas_longitude between -180 and 180),
      atlas_source text check (atlas_source in ('catalog', 'owner')),
      start_date date not null,
      end_date date not null,
      time_zone text not null check (char_length(time_zone) between 1 and 64),
      budget_amount numeric(18,4) check (budget_amount >= 0),
      budget_currency text check (budget_currency ~ '^[A-Z]{3}$'),
      version integer not null default 1 check (version >= 1),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (start_date <= end_date),
      check ((budget_amount is null) = (budget_currency is null)),
      check ((atlas_latitude is null) = (atlas_longitude is null) and (atlas_latitude is null) = (atlas_source is null))
    );
    create index trips_owner_start on trips(owner_user_id, start_date);

    create table trip_viewers (
      id uuid primary key default gen_random_uuid(),
      trip_id uuid not null references trips(id) on delete cascade,
      invitee_email_normalized text not null check (invitee_email_normalized = lower(btrim(invitee_email_normalized))),
      viewer_user_id uuid references "User"(id) on delete cascade,
      status text not null check (status in ('pending', 'accepted', 'revoked')),
      invitation_token_hash bytea,
      expires_at timestamptz,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (trip_id, invitee_email_normalized),
      check (status <> 'pending' or (invitation_token_hash is not null and expires_at is not null)),
      check (status <> 'accepted' or (viewer_user_id is not null and accepted_at is not null)),
      check (status <> 'revoked' or invitation_token_hash is null)
    );
    create index trip_viewers_viewer on trip_viewers(viewer_user_id, status, trip_id);
    create unique index trip_viewers_token on trip_viewers(invitation_token_hash) where invitation_token_hash is not null;

    create table import_receipts (
      id uuid primary key default gen_random_uuid(),
      owner_user_id uuid not null references "User"(id) on delete cascade,
      idempotency_key uuid not null,
      payload_hash bytea,
      trip_id uuid references trips(id) on delete set null,
      created_at timestamptz not null default now(),
      unique (owner_user_id, idempotency_key),
      check ((trip_id is null) = (payload_hash is null))
    );
    create index import_receipts_trip on import_receipts(trip_id);

    create table plan_items (
      id uuid primary key default gen_random_uuid(),
      trip_id uuid not null references trips(id) on delete cascade,
      type text not null check (type in ('flight', 'lodging', 'transport', 'meal', 'activity', 'other')),
      title text not null check (char_length(title) between 1 and 200 and title = btrim(title)),
      location text check (char_length(location) <= 500),
      notes text check (char_length(notes) <= 5000),
      links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 20),
      map_url text check (char_length(map_url) <= 2048 and map_url like 'https://%'),
      latitude numeric(8,5) check (latitude between -90 and 90),
      longitude numeric(8,5) check (longitude between -180 and 180),
      source text not null check (source in ('ai', 'manual')),
      local_date date,
      local_time time(0),
      time_zone text check (char_length(time_zone) <= 64),
      time_disambiguation text check (time_disambiguation in ('earlier', 'later')),
      duration_minutes integer check (duration_minutes between 1 and 20160),
      planned_departure_date date,
      airline text check (char_length(airline) <= 80),
      flight_number text check (char_length(flight_number) <= 16),
      departure_airport_code text check (departure_airport_code ~ '^[A-Z]{3}$'),
      departure_local_datetime timestamp(0),
      departure_time_zone text check (char_length(departure_time_zone) <= 64),
      departure_disambiguation text check (departure_disambiguation in ('earlier', 'later')),
      arrival_airport_code text check (arrival_airport_code ~ '^[A-Z]{3}$'),
      arrival_local_datetime timestamp(0),
      arrival_time_zone text check (char_length(arrival_time_zone) <= 64),
      arrival_disambiguation text check (arrival_disambiguation in ('earlier', 'later')),
      booking_status text not null check (booking_status in ('not_required', 'needs_booking', 'booked')),
      booking_due_date date,
      planned_amount numeric(18,4) check (planned_amount >= 0),
      planned_currency text check (planned_currency ~ '^[A-Z]{3}$'),
      price_label text check (price_label in ('estimate', 'quote')),
      price_source text check (price_source in ('ai', 'owner')),
      deleted_at timestamptz,
      version integer not null default 1 check (version >= 1),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((latitude is null) = (longitude is null)),
      check (latitude is null or map_url is not null),
      check (local_time is null or local_date is not null),
      check (time_disambiguation is null or local_time is not null),
      check (departure_local_datetime is null or departure_time_zone is not null),
      check (arrival_local_datetime is null or arrival_time_zone is not null),
      check (departure_disambiguation is null or departure_local_datetime is not null),
      check (arrival_disambiguation is null or arrival_local_datetime is not null),
      check (planned_departure_date is null or departure_local_datetime is null),
      check (type = 'flight' or (planned_departure_date is null and airline is null and flight_number is null
        and departure_airport_code is null and departure_local_datetime is null and departure_time_zone is null
        and departure_disambiguation is null and arrival_airport_code is null and arrival_local_datetime is null
        and arrival_time_zone is null and arrival_disambiguation is null)),
      check (type <> 'flight' or (local_date is null and local_time is null and time_zone is null
        and time_disambiguation is null and duration_minutes is null)),
      check (type <> 'flight' or booking_status <> 'not_required'),
      check (booking_due_date is null or booking_status = 'needs_booking'),
      check (type <> 'flight' or booking_status <> 'booked' or (departure_airport_code is not null
        and arrival_airport_code is not null and departure_local_datetime is not null and arrival_local_datetime is not null)),
      check ((planned_amount is null) = (planned_currency is null)
        and (planned_amount is null) = (price_label is null)
        and (planned_amount is null) = (price_source is null))
    );
    create index plan_items_timeline on plan_items(trip_id, local_date, created_at);
    create index plan_items_created on plan_items(trip_id, created_at);
    create index plan_items_due on plan_items(trip_id, booking_due_date)
      where booking_status = 'needs_booking' and booking_due_date is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists plan_items;
    drop table if exists import_receipts;
    drop table if exists trip_viewers;
    drop table if exists trips;
    drop table if exists "VerificationToken";
    drop table if exists "Session";
    drop table if exists "Account";
    drop table if exists "User";
  `.execute(db);
}
