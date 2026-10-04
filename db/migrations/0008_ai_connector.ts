import { sql, type Kysely } from "kysely";

/**
 * The AI connector's authorization server (technical design: AI connector): the apps that registered themselves,
 * one person's approval of one app, and the one-use codes and short-lived tokens it issues. Every secret is stored
 * only as its SHA-256 hash.
 *
 * The rollback drops the tables, which only ends AI connections; people connect again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table oauth_clients (
      id uuid primary key default gen_random_uuid(),
      name text not null check (char_length(name) between 1 and 100),
      redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
      created_at timestamptz not null default now()
    );

    create table oauth_grants (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references "User"(id) on delete cascade,
      client_id uuid not null references oauth_clients(id) on delete cascade,
      scope text not null check (scope in ('trips:read', 'trips:read trips:write')),
      resource text not null,
      created_at timestamptz not null default now(),
      last_used_at timestamptz,
      expires_at timestamptz not null,
      revoked_at timestamptz
    );
    create index oauth_grants_user_idx on oauth_grants (user_id) where revoked_at is null;
    create index oauth_grants_client_idx on oauth_grants (client_id);

    create table oauth_codes (
      code_hash bytea primary key,
      grant_id uuid not null references oauth_grants(id) on delete cascade,
      redirect_uri text not null,
      code_challenge text not null,
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create index oauth_codes_grant_idx on oauth_codes (grant_id);

    create table oauth_tokens (
      token_hash bytea primary key,
      grant_id uuid not null references oauth_grants(id) on delete cascade,
      kind text not null check (kind in ('access', 'refresh')),
      scope text not null check (scope in ('trips:read', 'trips:read trips:write')),
      expires_at timestamptz not null,
      used_at timestamptz
    );
    create index oauth_tokens_grant_idx on oauth_tokens (grant_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists oauth_tokens;
    drop table if exists oauth_codes;
    drop table if exists oauth_grants;
    drop table if exists oauth_clients;
  `.execute(db);
}
