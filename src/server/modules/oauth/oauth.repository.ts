import "server-only";
import type { Selectable } from "kysely";
import type { Conn, Tx } from "@/server/core/db/client";
import type { ConnectorScope, OAuthClientsTable, OAuthGrantsTable } from "@/server/core/db/schema";
import { isUuid } from "@/server/core/http/request";

/** SQL for the AI connector's authorization server. No rules here: oauth.service.ts decides. */

export type ClientRow = Selectable<OAuthClientsTable>;
export type GrantRow = Selectable<OAuthGrantsTable>;

export async function insertClient(db: Conn, name: string, redirectUris: string[]): Promise<ClientRow> {
  return db.insertInto("oauth_clients").values({ name, redirect_uris: redirectUris }).returningAll().executeTakeFirstOrThrow();
}

export async function clientById(db: Conn, id: string): Promise<ClientRow | undefined> {
  if (!isUuid(id)) return undefined;
  return db.selectFrom("oauth_clients").selectAll().where("id", "=", id).executeTakeFirst();
}

/** Clients nobody has approved yet: the pool a flood of registrations would fill. */
export async function countUnapprovedClients(db: Conn): Promise<number> {
  const row = await db
    .selectFrom("oauth_clients")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where((eb) => eb.not(eb.exists(eb.selectFrom("oauth_grants").select("oauth_grants.id").whereRef("oauth_grants.client_id", "=", "oauth_clients.id"))))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export async function insertGrant(tx: Tx, v: { userId: string; clientId: string; scope: ConnectorScope; resource: string; expiresAt: Date }): Promise<GrantRow> {
  return tx
    .insertInto("oauth_grants")
    .values({ user_id: v.userId, client_id: v.clientId, scope: v.scope, resource: v.resource, expires_at: v.expiresAt })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertCode(tx: Tx, v: { hash: Buffer; grantId: string; redirectUri: string; challenge: string; expiresAt: Date }): Promise<void> {
  await tx.insertInto("oauth_codes").values({ code_hash: v.hash, grant_id: v.grantId, redirect_uri: v.redirectUri, code_challenge: v.challenge, expires_at: v.expiresAt }).execute();
}

/** An authorization code with the approval it belongs to, locked for the exchange. */
export async function codeForUpdate(tx: Tx, hash: Buffer) {
  return tx
    .selectFrom("oauth_codes")
    .innerJoin("oauth_grants", "oauth_grants.id", "oauth_codes.grant_id")
    .select([
      "oauth_codes.grant_id",
      "oauth_codes.redirect_uri",
      "oauth_codes.code_challenge",
      "oauth_codes.expires_at as code_expires_at",
      "oauth_codes.used_at",
      "oauth_grants.client_id",
      "oauth_grants.scope",
      "oauth_grants.resource",
      "oauth_grants.expires_at as grant_expires_at",
      "oauth_grants.revoked_at",
    ])
    .where("oauth_codes.code_hash", "=", hash)
    .forUpdate("oauth_codes")
    .executeTakeFirst();
}

export async function markCodeUsed(tx: Tx, hash: Buffer, now: Date): Promise<void> {
  await tx.updateTable("oauth_codes").set({ used_at: now }).where("code_hash", "=", hash).execute();
}

/** A refresh token with its approval, locked; the approval row is locked too so two refreshes of one approval take turns. */
export async function refreshTokenForUpdate(tx: Tx, hash: Buffer) {
  const token = await tx
    .selectFrom("oauth_tokens")
    .select(["grant_id", "scope", "expires_at", "used_at"])
    .where("token_hash", "=", hash)
    .where("kind", "=", "refresh")
    .forUpdate()
    .executeTakeFirst();
  if (!token) return undefined;
  const grant = await tx.selectFrom("oauth_grants").select(["client_id", "resource", "expires_at", "revoked_at"]).where("id", "=", token.grant_id).forUpdate().executeTakeFirst();
  return grant ? { ...token, token_expires_at: token.expires_at, client_id: grant.client_id, resource: grant.resource, grant_expires_at: grant.expires_at, revoked_at: grant.revoked_at } : undefined;
}

export async function markRefreshUsed(tx: Tx, hash: Buffer, now: Date): Promise<void> {
  await tx.updateTable("oauth_tokens").set({ used_at: now }).where("token_hash", "=", hash).execute();
}

export async function insertToken(tx: Tx, v: { hash: Buffer; grantId: string; kind: "access" | "refresh"; scope: ConnectorScope; expiresAt: Date }): Promise<void> {
  await tx.insertInto("oauth_tokens").values({ token_hash: v.hash, grant_id: v.grantId, kind: v.kind, scope: v.scope, expires_at: v.expiresAt }).execute();
}

/** An approval is used: its idle expiry slides forward and its last use is recorded. */
export async function slideGrant(tx: Tx, grantId: string, expiresAt: Date, now: Date): Promise<void> {
  await tx.updateTable("oauth_grants").set({ expires_at: expiresAt, last_used_at: now }).where("id", "=", grantId).execute();
}

/** Ends an approval; every token it issued stops working with it. */
export async function revokeGrant(db: Conn, grantId: string, now: Date): Promise<void> {
  await db.updateTable("oauth_grants").set({ revoked_at: now }).where("id", "=", grantId).where("revoked_at", "is", null).execute();
}

/** What a bearer token stands for: the token, its approval and the person. */
export async function accessTokenLookup(db: Conn, hash: Buffer) {
  return db
    .selectFrom("oauth_tokens")
    .innerJoin("oauth_grants", "oauth_grants.id", "oauth_tokens.grant_id")
    .innerJoin("User", "User.id", "oauth_grants.user_id")
    .select([
      "oauth_tokens.grant_id",
      "oauth_tokens.scope",
      "oauth_tokens.expires_at as token_expires_at",
      "oauth_grants.resource",
      "oauth_grants.expires_at as grant_expires_at",
      "oauth_grants.revoked_at",
      "oauth_grants.last_used_at",
      "User.id as user_id",
      "User.email",
    ])
    .where("oauth_tokens.token_hash", "=", hash)
    .where("oauth_tokens.kind", "=", "access")
    .executeTakeFirst();
}

/** Records a use at most once a minute, so a busy chat does not write on every request. */
export async function touchGrant(db: Conn, grantId: string, now: Date): Promise<void> {
  await db
    .updateTable("oauth_grants")
    .set({ last_used_at: now })
    .where("id", "=", grantId)
    .where((eb) => eb.or([eb("last_used_at", "is", null), eb("last_used_at", "<", new Date(now.getTime() - 60_000))]))
    .execute();
}

/** The token a revocation request names, whichever kind, with its approval's client. */
export async function tokenOwner(db: Conn, hash: Buffer) {
  return db
    .selectFrom("oauth_tokens")
    .innerJoin("oauth_grants", "oauth_grants.id", "oauth_tokens.grant_id")
    .select(["oauth_tokens.grant_id", "oauth_grants.client_id"])
    .where("oauth_tokens.token_hash", "=", hash)
    .executeTakeFirst();
}

/** The person's live approvals with the app's name and return addresses, newest first. */
export async function liveGrantsOfUser(db: Conn, userId: string, now: Date) {
  return db
    .selectFrom("oauth_grants")
    .innerJoin("oauth_clients", "oauth_clients.id", "oauth_grants.client_id")
    .select([
      "oauth_grants.id",
      "oauth_grants.scope",
      "oauth_grants.created_at",
      "oauth_grants.last_used_at",
      "oauth_clients.name",
      "oauth_clients.redirect_uris",
    ])
    .where("oauth_grants.user_id", "=", userId)
    .where("oauth_grants.revoked_at", "is", null)
    .where("oauth_grants.expires_at", ">", now)
    .orderBy("oauth_grants.created_at", "desc")
    .orderBy("oauth_grants.id")
    .execute();
}

/** Ends one of the person's own approvals; false when they have no such live approval. */
export async function revokeGrantOfUser(db: Conn, grantId: string, userId: string, now: Date): Promise<boolean> {
  if (!isUuid(grantId)) return false;
  const rows = await db
    .updateTable("oauth_grants")
    .set({ revoked_at: now })
    .where("id", "=", grantId)
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null)
    .returning("id")
    .execute();
  return rows.length > 0;
}

/** Deletes what has expired for good: codes and tokens a day after expiry, ended approvals after 30 days, idle clients after a day. */
export async function pruneExpired(db: Conn, now: Date): Promise<void> {
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  await db.deleteFrom("oauth_codes").where("expires_at", "<", day).execute();
  await db.deleteFrom("oauth_tokens").where("expires_at", "<", day).execute();
  await db
    .deleteFrom("oauth_grants")
    .where((eb) => eb.or([eb("revoked_at", "<", month), eb("expires_at", "<", month)]))
    .execute();
  await db
    .deleteFrom("oauth_clients")
    .where("created_at", "<", day)
    .where((eb) => eb.not(eb.exists(eb.selectFrom("oauth_grants").select("oauth_grants.id").whereRef("oauth_grants.client_id", "=", "oauth_clients.id"))))
    .execute();
}

