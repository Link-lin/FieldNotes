import "server-only";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Actor } from "@/server/auth/actor";
import { actorFor } from "@/server/auth/actor";
import type { Tx } from "@/server/core/db/client";
import type { ConnectorScope, DB } from "@/server/core/db/schema";
import { HttpError } from "@/server/core/http/errors";
import { OAuthError } from "@/server/core/http/oauth";
import { errorTag } from "@/server/core/http/respond";
import { rateLimit } from "@/server/core/rate-limit";
import { countUsage } from "@/server/modules/usage/usage.service";
import type { ConnectionDTO } from "@/shared/dto";
import { connectorUrls } from "./oauth.metadata";
import { connectionDto } from "./oauth.mapper";
import * as repo from "./oauth.repository";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  READ_ONLY,
  READ_WRITE,
  REFRESH_RETRY_MS,
  REFRESH_TTL_MS,
  hasWrite,
  hashSecret,
  isCodeChallenge,
  isCodeVerifier,
  isSecret,
  narrowedScope,
  newSecret,
  redirectAllowed,
  registrableRedirect,
  requestedScope,
  verifyPkce,
  withParams,
} from "./oauth.rules";

/*
 * The AI connector's authorization server (technical design: AI connector): registration, the authorization
 * request and its approval, the token endpoint, revocation, bearer authentication and the person's connections.
 * Times come in as `now` so tests can move the clock.
 */

const MAX_UNAPPROVED_CLIENTS = 500;
const REGISTRATIONS_PER_MINUTE = 30;

/** Run now and then from the public routes, so expired rows go without a scheduled job. */
let lastPrune = 0;
async function maybePrune(db: Kysely<DB>, now: Date): Promise<void> {
  if (now.getTime() - lastPrune < 10 * 60 * 1000) return;
  lastPrune = now.getTime();
  try {
    await repo.pruneExpired(db, now);
  } catch (err) {
    console.error(`[connector] ${errorTag(err)}`);
  }
}

// ---- Registration (RFC 7591) ----

const registrationSchema = z.looseObject({
  redirect_uris: z.array(z.unknown()).min(1).max(5),
  client_name: z.unknown().optional(),
});

const cleanName = (value: unknown): string => {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return text || "App";
};

export type RegisteredClient = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  scope: string;
};

/** An app registers itself. Only public clients exist, so the answer says `none` whatever was asked for. */
export async function registerClient(db: Kysely<DB>, body: unknown, now = new Date()): Promise<RegisteredClient> {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError(400, "invalid_client_metadata", "Send redirect_uris: one to five addresses.");
  const redirects = parsed.data.redirect_uris.map(registrableRedirect);
  if (redirects.some((r) => r === null)) {
    throw new OAuthError(400, "invalid_redirect_uri", "A redirect address must be https, or http on localhost, with no fragment or user name.");
  }
  const limit = rateLimit("oauth-register", REGISTRATIONS_PER_MINUTE, 60_000, now.getTime());
  if (!limit.ok) throw new OAuthError(429, "temporarily_unavailable", "Too many registrations. Try again in a minute.");
  await maybePrune(db, now);
  if ((await repo.countUnapprovedClients(db)) >= MAX_UNAPPROVED_CLIENTS) throw new OAuthError(429, "temporarily_unavailable", "Too many apps are waiting for approval. Try again later.");
  const uris = [...new Set(redirects as string[])];
  const client = await repo.insertClient(db, cleanName(parsed.data.client_name), uris);
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: READ_WRITE,
  };
}

// ---- The authorization request and its approval ----

export type AuthorizationParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

export type AuthorizationRequest = {
  client: { id: string; name: string; redirectUris: string[] };
  redirectUri: string;
  state: string | undefined;
  /** What the app asked for; the person may approve less. */
  scope: ConnectorScope;
  codeChallenge: string;
};

/** The request cannot be trusted enough to send the person back to the app: show this, redirect nowhere. */
export class AuthorizationPageError extends Error {}
/** The request is understood but wrong: send the person back to the app with an OAuth error. */
export class AuthorizationRedirectError extends Error {
  constructor(
    readonly redirectTo: string,
    message: string,
  ) {
    super(message);
  }
}

/** Validates an authorization request (RFC 6749 section 4.1.1 with PKCE, RFC 8707 and RFC 9207). */
export async function checkAuthorizationRequest(db: Kysely<DB>, p: AuthorizationParams): Promise<AuthorizationRequest> {
  const client = p.client_id ? await repo.clientById(db, p.client_id) : undefined;
  if (!client) throw new AuthorizationPageError("This link isn't valid. Start again from the app you are connecting.");
  if (!p.redirect_uri || !redirectAllowed(client.redirect_uris, p.redirect_uri)) {
    throw new AuthorizationPageError("This link isn't valid. Start again from the app you are connecting.");
  }
  const redirectUri = p.redirect_uri;
  const iss = connectorUrls().issuer;
  const fail = (error: string, message: string): never => {
    throw new AuthorizationRedirectError(withParams(redirectUri, { error, error_description: message, state: p.state?.slice(0, 512), iss }), message);
  };
  if (p.response_type !== "code") fail("unsupported_response_type", "Only response_type=code is supported.");
  if (p.code_challenge_method !== "S256") fail("invalid_request", "Use code_challenge_method=S256.");
  if (!p.code_challenge || !isCodeChallenge(p.code_challenge)) fail("invalid_request", "Send a valid S256 code_challenge.");
  if (p.state !== undefined && p.state.length > 512) fail("invalid_request", "The state value is too long.");
  if (p.resource !== undefined && p.resource !== connectorUrls().resource) fail("invalid_target", "That is not this server's MCP address.");
  return {
    client: { id: client.id, name: client.name, redirectUris: client.redirect_uris },
    redirectUri,
    state: p.state,
    scope: requestedScope(p.scope),
    codeChallenge: p.code_challenge!,
  };
}

/**
 * The person's decision on an authorization request. Allow creates the approval and a 60-second code and returns
 * where to send the browser; deny sends `access_denied`. `allowChanges` can only narrow what the app asked for.
 */
export async function decideAuthorization(
  db: Kysely<DB>,
  actor: Actor,
  params: AuthorizationParams,
  decision: "allow" | "deny",
  allowChanges: boolean,
  now = new Date(),
): Promise<{ redirectTo: string }> {
  const request = await checkAuthorizationRequest(db, params);
  const iss = connectorUrls().issuer;
  if (decision === "deny") return { redirectTo: withParams(request.redirectUri, { error: "access_denied", state: request.state, iss }) };
  const scope = hasWrite(request.scope) && allowChanges ? READ_WRITE : READ_ONLY;
  const code = newSecret("code");
  await db.transaction().execute(async (tx) => {
    const grant = await repo.insertGrant(tx, { userId: actor.userId, clientId: request.client.id, scope, resource: connectorUrls().resource, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) });
    await repo.insertCode(tx, { hash: hashSecret(code), grantId: grant.id, redirectUri: request.redirectUri, challenge: request.codeChallenge, expiresAt: new Date(now.getTime() + CODE_TTL_MS) });
  });
  await countUsage(db, [{ name: "connector_connected" }]);
  return { redirectTo: withParams(request.redirectUri, { code, state: request.state, iss }) };
}

// ---- Tokens ----

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

type Exchange = { ok: TokenResponse } | { fail: OAuthError };
const failure = (error: string, message: string, status = 400): Exchange => ({ fail: new OAuthError(status, error, message) });

/** Issues a new pair for an approval and slides its idle expiry forward. */
async function issueTokens(tx: Tx, grantId: string, scope: ConnectorScope, now: Date): Promise<TokenResponse> {
  const access = newSecret("access");
  const refresh = newSecret("refresh");
  await repo.insertToken(tx, { hash: hashSecret(access), grantId, kind: "access", scope, expiresAt: new Date(now.getTime() + ACCESS_TTL_MS) });
  await repo.insertToken(tx, { hash: hashSecret(refresh), grantId, kind: "refresh", scope, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) });
  await repo.slideGrant(tx, grantId, new Date(now.getTime() + REFRESH_TTL_MS), now);
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope };
}

const field = (form: URLSearchParams, name: string): string | undefined => {
  const value = form.get(name);
  return value === null || value === "" ? undefined : value;
};

/** `POST /oauth/token`: an authorization code or a refresh token for a new pair of tokens. */
export async function exchangeToken(db: Kysely<DB>, form: URLSearchParams, now = new Date()): Promise<TokenResponse> {
  await maybePrune(db, now);
  const grantType = field(form, "grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    throw new OAuthError(400, "unsupported_grant_type", "Use grant_type authorization_code or refresh_token.");
  }
  const clientId = field(form, "client_id");
  if (!clientId) throw new OAuthError(400, "invalid_request", "Send client_id.");
  const client = await repo.clientById(db, clientId);
  if (!client) throw new OAuthError(401, "invalid_client", "That client isn't registered.");
  const result = grantType === "authorization_code" ? await exchangeCode(db, form, clientId, now) : await refreshTokens(db, form, clientId, now);
  if ("fail" in result) throw result.fail;
  return result.ok;
}

async function exchangeCode(db: Kysely<DB>, form: URLSearchParams, clientId: string, now: Date): Promise<Exchange> {
  const code = field(form, "code");
  const redirectUri = field(form, "redirect_uri");
  const verifier = field(form, "code_verifier");
  if (!code || !redirectUri || !verifier) return failure("invalid_request", "Send code, redirect_uri and code_verifier.");
  if (!isCodeVerifier(verifier)) return failure("invalid_request", "The code_verifier is malformed.");
  const resource = field(form, "resource");
  if (!isSecret("code", code)) return failure("invalid_grant", "That code isn't valid.");
  const hash = hashSecret(code);
  return db.transaction().execute(async (tx): Promise<Exchange> => {
    const row = await repo.codeForUpdate(tx, hash);
    if (!row || row.client_id !== clientId) return failure("invalid_grant", "That code isn't valid.");
    // A code is single use: presenting it again means it leaked, so the approval ends with it.
    if (row.used_at) {
      await repo.revokeGrant(tx, row.grant_id, now);
      return failure("invalid_grant", "That code was already used.");
    }
    if (row.code_expires_at <= now || row.revoked_at || row.grant_expires_at <= now) return failure("invalid_grant", "That code has expired.");
    if (row.redirect_uri !== redirectUri) return failure("invalid_grant", "The redirect_uri differs from the one in the authorization request.");
    if (!verifyPkce(verifier, row.code_challenge)) return failure("invalid_grant", "The code_verifier does not match.");
    if (resource !== undefined && resource !== row.resource) return failure("invalid_target", "That is not this server's MCP address.");
    await repo.markCodeUsed(tx, hash, now);
    return { ok: await issueTokens(tx, row.grant_id, row.scope, now) };
  });
}

async function refreshTokens(db: Kysely<DB>, form: URLSearchParams, clientId: string, now: Date): Promise<Exchange> {
  const refresh = field(form, "refresh_token");
  if (!refresh) return failure("invalid_request", "Send refresh_token.");
  if (!isSecret("refresh", refresh)) return failure("invalid_grant", "That refresh token isn't valid.");
  const resource = field(form, "resource");
  const hash = hashSecret(refresh);
  return db.transaction().execute(async (tx): Promise<Exchange> => {
    const row = await repo.refreshTokenForUpdate(tx, hash);
    if (!row || row.client_id !== clientId) return failure("invalid_grant", "That refresh token isn't valid.");
    if (row.revoked_at || row.grant_expires_at <= now || row.token_expires_at <= now) return failure("invalid_grant", "That refresh token has expired.");
    if (row.used_at) {
      // Within the retry window a repeat is a lost answer or a race; later it means the token leaked.
      if (now.getTime() - row.used_at.getTime() > REFRESH_RETRY_MS) {
        await repo.revokeGrant(tx, row.grant_id, now);
        return failure("invalid_grant", "That refresh token was already used.");
      }
    } else {
      await repo.markRefreshUsed(tx, hash, now);
    }
    const scope = narrowedScope(form.get("scope"), row.scope);
    if (!scope) return failure("invalid_scope", "That scope was not granted.");
    if (resource !== undefined && resource !== row.resource) return failure("invalid_target", "That is not this server's MCP address.");
    return { ok: await issueTokens(tx, row.grant_id, scope, now) };
  });
}

/** `POST /oauth/revoke` (RFC 7009): ends the approval a token belongs to, if the app that holds it asks. */
export async function revokeToken(db: Kysely<DB>, form: URLSearchParams, now = new Date()): Promise<void> {
  const token = field(form, "token");
  const clientId = field(form, "client_id");
  if (!token || !clientId) throw new OAuthError(400, "invalid_request", "Send token and client_id.");
  if (!isSecret("access", token) && !isSecret("refresh", token)) return;
  const owner = await repo.tokenOwner(db, hashSecret(token));
  if (owner && owner.client_id === clientId) await repo.revokeGrant(db, owner.grant_id, now);
}

// ---- Bearer authentication for /mcp ----

export type ConnectorSession = { actor: Actor; scope: ConnectorScope; grantId: string };

/**
 * Who a bearer token stands for, or null when it is unknown, expired, revoked or meant for another address.
 * Role checks stay with each trip; this only says who is calling and with what scope.
 */
export async function authenticateAccessToken(db: Kysely<DB>, token: string, now = new Date()): Promise<ConnectorSession | null> {
  if (!isSecret("access", token)) return null;
  const row = await repo.accessTokenLookup(db, hashSecret(token));
  if (!row || row.revoked_at || row.token_expires_at <= now || row.grant_expires_at <= now) return null;
  if (row.resource !== connectorUrls().resource) return null;
  await repo.touchGrant(db, row.grant_id, now);
  return { actor: actorFor({ id: row.user_id, email: row.email }), scope: row.scope, grantId: row.grant_id };
}

// ---- The person's connections ----

export async function listConnections(db: Kysely<DB>, actor: Actor, now = new Date()): Promise<ConnectionDTO[]> {
  return (await repo.liveGrantsOfUser(db, actor.userId, now)).map(connectionDto);
}

/** CONNECT-5: disconnect one of the person's own apps; it stops working on its next request. */
export async function disconnect(db: Kysely<DB>, actor: Actor, connectionId: string, now = new Date()): Promise<void> {
  if (!(await repo.revokeGrantOfUser(db, connectionId, actor.userId, now))) throw new HttpError(404, "not_found", "That connection doesn't exist.");
}
