import { createHash, randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, reset, testDb } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { resetRateLimits } from "@/server/core/rate-limit";
import { codeChallengeFor, hashSecret } from "@/server/modules/oauth/oauth.rules";
import {
  authenticateAccessToken,
  checkAuthorizationRequest,
  decideAuthorization,
  disconnect,
  exchangeToken,
  listConnections,
  type AuthorizationParams,
} from "@/server/modules/oauth/oauth.service";
import { deleteAccount } from "@/server/modules/account/account.service";

// The route handlers run for real; only the session lookup (for the consent decision) is replaced.
const session = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/auth/session", async () => {
  const { HttpError } = await import("@/server/core/http/errors");
  return {
    currentActor: async () => session.actor,
    requireActor: async () => {
      if (!session.actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
      return session.actor;
    },
  };
});

const registerRoute = await import("@/app/oauth/register/route");
const tokenRoute = await import("@/app/oauth/token/route");
const revokeRoute = await import("@/app/oauth/revoke/route");
const approveRoute = await import("@/app/api/connector/approve/route");
const connectionsRoute = await import("@/app/api/connector/connections/route");
const connectionRoute = await import("@/app/api/connector/connections/[connectionId]/route");
const serverDoc = await import("@/app/.well-known/oauth-authorization-server/route");
const resourceDoc = await import("@/app/.well-known/oauth-protected-resource/mcp/route");
const resourceRootDoc = await import("@/app/.well-known/oauth-protected-resource/route");

const ORIGIN = "http://localhost:3000";
const RESOURCE = `${ORIGIN}/mcp`;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const db = () => testDb();

const post = (path: string, body: BodyInit, type: string, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": type, ...extra }, body });
const form = (path: string, values: Record<string, string>) => post(path, new URLSearchParams(values).toString(), "application/x-www-form-urlencoded");
const json = (path: string, value: unknown, extra: Record<string, string> = {}) => post(path, JSON.stringify(value), "application/json", extra);

async function register(over: Record<string, unknown> = {}) {
  const res = await registerRoute.POST(json("/oauth/register", { client_name: "Claude", redirect_uris: [CLAUDE], ...over }));
  return { res, body: (await res.json()) as Record<string, string & string[]> };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: codeChallengeFor(verifier) };
}

type Client = { client_id: string };
function authParams(client: Client, challenge: string, over: Partial<AuthorizationParams> = {}): AuthorizationParams {
  return {
    client_id: client.client_id,
    redirect_uri: CLAUDE,
    response_type: "code",
    state: "xyz",
    scope: "trips:read trips:write",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    ...over,
  };
}

/** Approves through the real consent route and returns the code the app would receive. */
async function approve(actor: Actor, params: AuthorizationParams, allowChanges = true) {
  session.actor = actor;
  const res = await approveRoute.POST(json("/api/connector/approve", { ...params, decision: "allow", allowChanges }, { origin: ORIGIN }));
  expect(res.status).toBe(200);
  const url = new URL(((await res.json()) as { redirectTo: string }).redirectTo);
  return { url, code: url.searchParams.get("code")! };
}

async function exchange(client: Client, code: string, verifier: string, over: Record<string, string> = {}) {
  return tokenRoute.POST(form("/oauth/token", { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CLAUDE, code_verifier: verifier, ...over }));
}

type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
/** The whole flow: register, approve, exchange. */
async function connect(actor: Actor, opts: { allowChanges?: boolean; scope?: string } = {}) {
  const { body: client } = await register();
  const { verifier, challenge } = pkce();
  const { code } = await approve(actor, authParams(client as unknown as Client, challenge, opts.scope ? { scope: opts.scope } : {}), opts.allowChanges ?? true);
  const res = await exchange(client as unknown as Client, code, verifier);
  expect(res.status).toBe(200);
  return { client: client as unknown as Client, tokens: (await res.json()) as Tokens };
}

const refreshForm = (client: Client, token: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: token, ...extra });

let ann: Actor, bob: Actor;
beforeEach(async () => {
  await reset();
  resetRateLimits();
  ann = await makeActor("owner@example.com", "Ann");
  bob = await makeActor("bob@example.com", "Bob");
  session.actor = null;
  delete process.env.AI_CONNECTOR;
});
afterEach(() => {
  delete process.env.AI_CONNECTOR;
});

describe("discovery documents", () => {
  it("name the endpoints, S256, public clients and the iss parameter", async () => {
    const res = await serverDoc.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await res.json();
    expect(doc).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(doc.scopes_supported).toEqual(["trips:read", "trips:write", "offline_access"]);
    expect(doc.client_id_metadata_document_supported).toBeUndefined();
  });

  it("name the resource and its authorization server, at both well-known paths", async () => {
    for (const handler of [resourceDoc.GET, resourceRootDoc.GET]) {
      const doc = await (await handler()).json();
      expect(doc).toMatchObject({ resource: RESOURCE, authorization_servers: [ORIGIN], bearer_methods_supported: ["header"] });
      expect(doc.scopes_supported).toEqual(["trips:read", "trips:write"]);
    }
  });

  it("answer 404 for everything when the connector is off", async () => {
    process.env.AI_CONNECTOR = "off";
    expect((await serverDoc.GET()).status).toBe(404);
    expect((await resourceDoc.GET()).status).toBe(404);
    expect((await registerRoute.POST(json("/oauth/register", { redirect_uris: [CLAUDE] }))).status).toBe(404);
    expect((await tokenRoute.POST(form("/oauth/token", { grant_type: "refresh_token" }))).status).toBe(404);
    expect((await revokeRoute.POST(form("/oauth/revoke", { token: "x", client_id: "y" }))).status).toBe(404);
    session.actor = ann;
    expect((await connectionsRoute.GET(new Request(`${ORIGIN}/api/connector/connections`))).status).toBe(404);
    const denied = await approveRoute.POST(json("/api/connector/approve", { client_id: "x", redirect_uri: CLAUDE, response_type: "code", code_challenge: "x", code_challenge_method: "S256", decision: "allow", allowChanges: true }, { origin: ORIGIN }));
    expect(denied.status).toBe(404);
  });
});

describe("registration", () => {
  it("registers a public client and says so", async () => {
    const { res, body } = await register({ token_endpoint_auth_method: "client_secret_basic", logo_uri: "https://evil.example/x.png" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ client_name: "Claude", redirect_uris: [CLAUDE], token_endpoint_auth_method: "none", response_types: ["code"] });
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("client_secret");
    expect(body).not.toHaveProperty("logo_uri");
    const rows = await db().selectFrom("oauth_clients").selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it("cleans the name and falls back to a default", async () => {
    expect((await register({ client_name: "  Claude\n\u0000 Desktop  " })).body.client_name).toBe("Claude Desktop");
    expect((await register({ client_name: "x".repeat(300) })).body.client_name).toHaveLength(100);
    expect((await register({ client_name: "" })).body.client_name).toBe("App");
    expect((await register({ client_name: 42 })).body.client_name).toBe("App");
    const noName = await registerRoute.POST(json("/oauth/register", { redirect_uris: [CLAUDE] }));
    expect((await noName.json()).client_name).toBe("App");
  });

  it("refuses redirect addresses it cannot trust, with the OAuth error", async () => {
    for (const bad of ["http://evil.example/cb", "javascript:alert(1)", "https://u:p@claude.ai/cb", "https://claude.ai/cb#x", 7]) {
      const { res, body } = await register({ redirect_uris: [bad] });
      expect(res.status, String(bad)).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
    for (const bad of [[], undefined, "https://claude.ai/cb", Array(6).fill(CLAUDE)]) {
      const { res, body } = await register({ redirect_uris: bad });
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_client_metadata");
    }
    expect(await db().selectFrom("oauth_clients").selectAll().execute()).toHaveLength(0);
  });

  it("refuses a body that is not JSON or is too large", async () => {
    const notJson = await registerRoute.POST(post("/oauth/register", "redirect_uris=x", "application/x-www-form-urlencoded"));
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).error).toBe("invalid_client_metadata");
    const big = await registerRoute.POST(json("/oauth/register", { redirect_uris: [CLAUDE], client_name: "x".repeat(9000) }));
    expect(big.status).toBe(413);
  });

  it("is limited to 30 a minute and to 500 clients nobody has approved", async () => {
    for (let i = 0; i < 30; i++) expect((await register()).res.status).toBe(201);
    const limited = await register();
    expect(limited.res.status).toBe(429);
    expect(limited.body.error).toBe("temporarily_unavailable");

    resetRateLimits();
    await db().deleteFrom("oauth_clients").execute();
    await db().insertInto("oauth_clients").values(Array.from({ length: 500 }, (_, i) => ({ name: `app ${i}`, redirect_uris: [CLAUDE] }))).execute();
    const full = await register();
    expect(full.res.status).toBe(429);

    // An approved client is not counted against the limit.
    const { client } = await (async () => {
      await db().deleteFrom("oauth_clients").execute();
      return connect(ann);
    })();
    await db().insertInto("oauth_clients").values(Array.from({ length: 499 }, (_, i) => ({ name: `app ${i}`, redirect_uris: [CLAUDE] }))).execute();
    expect((await register()).res.status).toBe(201);
    expect(client.client_id).toBeTruthy();
  });
});

describe("the authorization request", () => {
  it("shows an error page, and redirects nowhere, for an unknown client or an address that was not registered", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    await expect(checkAuthorizationRequest(db(), authParams({ client_id: "00000000-0000-4000-8000-000000000000" }, challenge))).rejects.toThrow(/isn't valid/);
    await expect(checkAuthorizationRequest(db(), authParams({ client_id: "not-a-uuid" }, challenge))).rejects.toThrow(/isn't valid/);
    await expect(checkAuthorizationRequest(db(), authParams(client as unknown as Client, challenge, { client_id: undefined }))).rejects.toThrow(/isn't valid/);
    for (const redirect_uri of ["https://evil.example/cb", `${CLAUDE}/`, "http://claude.ai/api/mcp/auth_callback", undefined]) {
      await expect(checkAuthorizationRequest(db(), authParams(client as unknown as Client, challenge, { redirect_uri }))).rejects.toMatchObject({ name: "Error", message: expect.stringMatching(/isn't valid/) });
    }
  });

  it("sends a problem back to the app with state and iss", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    const c = client as unknown as Client;
    const redirected = async (over: Partial<AuthorizationParams>) => {
      try {
        await checkAuthorizationRequest(db(), authParams(c, challenge, over));
      } catch (err) {
        const url = new URL((err as { redirectTo: string }).redirectTo);
        expect(url.origin + url.pathname).toBe(CLAUDE);
        expect(url.searchParams.get("iss")).toBe(ORIGIN);
        return url.searchParams;
      }
      throw new Error("expected a redirect error");
    };
    expect((await redirected({ response_type: "token" })).get("error")).toBe("unsupported_response_type");
    expect((await redirected({ code_challenge_method: "plain" })).get("error")).toBe("invalid_request");
    expect((await redirected({ code_challenge_method: undefined })).get("error")).toBe("invalid_request");
    expect((await redirected({ code_challenge: undefined })).get("error")).toBe("invalid_request");
    expect((await redirected({ code_challenge: "short" })).get("error")).toBe("invalid_request");
    const wrongResource = await redirected({ resource: "https://other.example/mcp" });
    expect(wrongResource.get("error")).toBe("invalid_target");
    expect(wrongResource.get("state")).toBe("xyz");
    expect((await redirected({ state: "s".repeat(513) })).get("error")).toBe("invalid_request");
  });

  it("accepts a request without a resource or scope, and a loopback address on any port", async () => {
    const { body: loopback } = await register({ redirect_uris: ["http://localhost/callback"] });
    const { challenge } = pkce();
    const request = await checkAuthorizationRequest(db(), {
      client_id: loopback.client_id,
      redirect_uri: "http://localhost:53682/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(request.scope).toBe("trips:read");
    expect(request.state).toBeUndefined();
    expect(request.client.name).toBe("Claude");
  });
});

describe("approving", () => {
  it("returns the app's address with a code, its state and iss", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    const { url, code } = await approve(ann, authParams(client as unknown as Client, challenge));
    expect(url.origin + url.pathname).toBe(CLAUDE);
    expect(code).toMatch(/^fn_ac_[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
    const grant = await db().selectFrom("oauth_grants").selectAll().executeTakeFirstOrThrow();
    expect(grant).toMatchObject({ user_id: ann.userId, scope: "trips:read trips:write", resource: RESOURCE, revoked_at: null });
    const stored = await db().selectFrom("oauth_codes").selectAll().executeTakeFirstOrThrow();
    expect(stored.code_hash.equals(hashSecret(code))).toBe(true);
    expect(stored.code_hash.toString("utf8")).not.toContain(code);
    const counts = await sql<{ n: number }>`select count as n from usage_counts where name = 'connector_connected'`.execute(db());
    expect(Number(counts.rows[0]?.n)).toBe(1);
  });

  it("lets the person approve less than the app asked for", async () => {
    const { client, tokens } = await connect(ann, { allowChanges: false });
    expect(tokens.scope).toBe("trips:read");
    expect(client.client_id).toBeTruthy();
    const grant = await db().selectFrom("oauth_grants").selectAll().executeTakeFirstOrThrow();
    expect(grant.scope).toBe("trips:read");
  });

  it("gives an app that only asked to read nothing more, whatever the person ticks", async () => {
    const { tokens } = await connect(ann, { scope: "trips:read", allowChanges: true });
    expect(tokens.scope).toBe("trips:read");
  });

  it("sends access_denied when the person cancels, and grants nothing", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    session.actor = ann;
    const res = await approveRoute.POST(json("/api/connector/approve", { ...authParams(client as unknown as Client, challenge), decision: "deny", allowChanges: true }, { origin: ORIGIN }));
    const url = new URL(((await res.json()) as { redirectTo: string }).redirectTo);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
    expect(url.searchParams.has("code")).toBe(false);
    expect(await db().selectFrom("oauth_grants").selectAll().execute()).toHaveLength(0);
  });

  it("needs a signed-in person and the app's own origin", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    const body = { ...authParams(client as unknown as Client, challenge), decision: "allow", allowChanges: true };
    session.actor = null;
    expect((await approveRoute.POST(json("/api/connector/approve", body, { origin: ORIGIN }))).status).toBe(401);
    session.actor = ann;
    expect((await approveRoute.POST(json("/api/connector/approve", body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await approveRoute.POST(json("/api/connector/approve", body))).status).toBe(403);
    expect(await db().selectFrom("oauth_grants").selectAll().execute()).toHaveLength(0);
  });

  it("revalidates the request: a tampered redirect address is refused, a request error goes back to the app", async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    session.actor = ann;
    const tampered = await approveRoute.POST(json("/api/connector/approve", { ...authParams(client as unknown as Client, challenge, { redirect_uri: "https://evil.example/cb" }), decision: "allow", allowChanges: true }, { origin: ORIGIN }));
    expect(tampered.status).toBe(422);
    expect((await tampered.json()).error.code).toBe("invalid_authorization_request");
    const plain = await approveRoute.POST(json("/api/connector/approve", { ...authParams(client as unknown as Client, challenge, { code_challenge_method: "plain" }), decision: "allow", allowChanges: true }, { origin: ORIGIN }));
    expect(plain.status).toBe(200);
    expect(new URL(((await plain.json()) as { redirectTo: string }).redirectTo).searchParams.get("error")).toBe("invalid_request");
    expect(await db().selectFrom("oauth_grants").selectAll().execute()).toHaveLength(0);
  });
});

describe("exchanging a code", () => {
  it("returns an access token, a refresh token and the scope, and stores only hashes", async () => {
    const { tokens } = await connect(ann);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "trips:read trips:write" });
    expect(tokens.access_token).toMatch(/^fn_at_/);
    expect(tokens.refresh_token).toMatch(/^fn_rt_/);
    const rows = await db().selectFrom("oauth_tokens").selectAll().execute();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect([hashSecret(tokens.access_token), hashSecret(tokens.refresh_token)].some((h) => h.equals(row.token_hash))).toBe(true);
    }
    const res = await exchange({ client_id: "x" }, "x", "x");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("authenticates the person who approved, with the scope they gave", async () => {
    const { tokens } = await connect(ann, { allowChanges: false });
    const who = await authenticateAccessToken(db(), tokens.access_token);
    expect(who?.actor.userId).toBe(ann.userId);
    expect(who?.actor.isOwner).toBe(true);
    expect(who?.scope).toBe("trips:read");
    const bobs = await connect(bob);
    expect((await authenticateAccessToken(db(), bobs.tokens.access_token))?.actor.isOwner).toBe(false);
  });

  it("refuses a wrong verifier, redirect address, client, resource or unknown code, each as invalid_grant", async () => {
    const { body: client } = await register();
    const c = client as unknown as Client;
    const { verifier, challenge } = pkce();
    const { code } = await approve(ann, authParams(c, challenge));
    const other = (await register()).body as unknown as Client;
    const refused = async (res: Response, error = "invalid_grant", status = 400) => {
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(error);
    };
    await refused(await exchange(c, code, pkce().verifier));
    await refused(await exchange(c, code, verifier, { redirect_uri: `${CLAUDE}?x=1` }));
    await refused(await exchange(other, code, verifier));
    await refused(await exchange(c, code, verifier, { resource: "https://other.example/mcp" }), "invalid_target");
    await refused(await exchange(c, `fn_ac_${"A".repeat(43)}`, verifier));
    await refused(await exchange(c, "not-a-code", verifier));
    // None of those used the code up.
    expect((await exchange(c, code, verifier)).status).toBe(200);
  });

  it("asks for what is missing, and refuses an unknown client or grant type", async () => {
    const { body: client } = await register();
    const c = client as unknown as Client;
    const missing = await tokenRoute.POST(form("/oauth/token", { grant_type: "authorization_code", client_id: c.client_id }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("invalid_request");
    const noClient = await tokenRoute.POST(form("/oauth/token", { grant_type: "authorization_code" }));
    expect((await noClient.json()).error).toBe("invalid_request");
    const unknown = await tokenRoute.POST(form("/oauth/token", { grant_type: "authorization_code", client_id: "00000000-0000-4000-8000-000000000000", code: "x", redirect_uri: CLAUDE, code_verifier: "x" }));
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe("invalid_client");
    const type = await tokenRoute.POST(form("/oauth/token", { grant_type: "password", client_id: c.client_id }));
    expect((await type.json()).error).toBe("unsupported_grant_type");
    const asJson = await tokenRoute.POST(json("/oauth/token", { grant_type: "refresh_token", client_id: c.client_id }));
    expect((await asJson.json()).error).toBe("invalid_request");
  });

  it("refuses a code after 60 seconds", async () => {
    const { body: client } = await register();
    const c = client as unknown as Client;
    const { verifier, challenge } = pkce();
    const t0 = new Date("2026-10-04T10:00:00Z");
    const { redirectTo } = await decideAuthorization(db(), ann, authParams(c, challenge), "allow", true, t0);
    const code = new URL(redirectTo).searchParams.get("code")!;
    const request = (extra: Record<string, string> = {}) => new URLSearchParams({ grant_type: "authorization_code", client_id: c.client_id, code, redirect_uri: CLAUDE, code_verifier: verifier, ...extra });
    await expect(exchangeToken(db(), request(), new Date(t0.getTime() + 61_000))).rejects.toMatchObject({ error: "invalid_grant" });
    const ok = await exchangeToken(db(), request(), new Date(t0.getTime() + 59_000));
    expect(ok.expires_in).toBe(3600);
  });

  it("revokes the approval when a code is used twice, so the first tokens stop working", async () => {
    const { body: client } = await register();
    const c = client as unknown as Client;
    const { verifier, challenge } = pkce();
    const { code } = await approve(ann, authParams(c, challenge));
    const first = (await (await exchange(c, code, verifier)).json()) as Tokens;
    expect(await authenticateAccessToken(db(), first.access_token)).not.toBeNull();
    const again = await exchange(c, code, verifier);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
    expect(await authenticateAccessToken(db(), first.access_token)).toBeNull();
    const refresh = await tokenRoute.POST(form("/oauth/token", Object.fromEntries(refreshForm(c, first.refresh_token))));
    expect((await refresh.json()).error).toBe("invalid_grant");
  });
});

describe("access tokens", () => {
  it("last an hour and not longer", async () => {
    const { tokens } = await connect(ann);
    const soon = new Date(Date.now() + 59 * 60_000);
    const late = new Date(Date.now() + 61 * 60_000);
    expect(await authenticateAccessToken(db(), tokens.access_token, soon)).not.toBeNull();
    expect(await authenticateAccessToken(db(), tokens.access_token, late)).toBeNull();
  });

  it("are not accepted when unknown, malformed, of the wrong kind or meant for another address", async () => {
    const { tokens } = await connect(ann);
    expect(await authenticateAccessToken(db(), `fn_at_${"A".repeat(43)}`)).toBeNull();
    expect(await authenticateAccessToken(db(), "nonsense")).toBeNull();
    expect(await authenticateAccessToken(db(), tokens.refresh_token)).toBeNull();
    expect(await authenticateAccessToken(db(), tokens.access_token)).not.toBeNull();
    await db().updateTable("oauth_grants").set({ resource: "https://other.example/mcp" }).execute();
    expect(await authenticateAccessToken(db(), tokens.access_token)).toBeNull();
  });

  it("record when the approval was last used, at most once a minute", async () => {
    const { tokens } = await connect(ann);
    const t = new Date(Date.now() + 5 * 60_000);
    await authenticateAccessToken(db(), tokens.access_token, t);
    const first = (await db().selectFrom("oauth_grants").select("last_used_at").executeTakeFirstOrThrow()).last_used_at!;
    expect(first.getTime()).toBe(t.getTime());
    await authenticateAccessToken(db(), tokens.access_token, new Date(t.getTime() + 30_000));
    expect((await db().selectFrom("oauth_grants").select("last_used_at").executeTakeFirstOrThrow()).last_used_at!.getTime()).toBe(t.getTime());
    await authenticateAccessToken(db(), tokens.access_token, new Date(t.getTime() + 61_000));
    expect((await db().selectFrom("oauth_grants").select("last_used_at").executeTakeFirstOrThrow()).last_used_at!.getTime()).toBe(t.getTime() + 61_000);
  });
});

describe("refreshing", () => {
  it("rotates: a new pair, the old refresh token spent, the approval's expiry slid forward", async () => {
    const { client, tokens } = await connect(ann);
    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const next = await exchangeToken(db(), refreshForm(client, tokens.refresh_token), later);
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.scope).toBe("trips:read trips:write");
    const grant = await db().selectFrom("oauth_grants").selectAll().executeTakeFirstOrThrow();
    expect(grant.expires_at.getTime()).toBe(later.getTime() + 60 * 24 * 60 * 60 * 1000);
    expect(await authenticateAccessToken(db(), next.access_token, later)).not.toBeNull();
  });

  it("lets a repeat within 30 seconds through (a lost answer, or two requests at once), and revokes after that", async () => {
    const { client, tokens } = await connect(ann);
    const t0 = new Date(Date.now() + 10 * 60_000);
    const a = await exchangeToken(db(), refreshForm(client, tokens.refresh_token), t0);
    const b = await exchangeToken(db(), refreshForm(client, tokens.refresh_token), new Date(t0.getTime() + 20_000));
    expect(b.refresh_token).not.toBe(a.refresh_token);
    await expect(exchangeToken(db(), refreshForm(client, tokens.refresh_token), new Date(t0.getTime() + 31_000))).rejects.toMatchObject({ error: "invalid_grant" });
    // The reuse ended the approval, so even the newest tokens are dead.
    expect(await authenticateAccessToken(db(), b.access_token, new Date(t0.getTime() + 32_000))).toBeNull();
    await expect(exchangeToken(db(), refreshForm(client, b.refresh_token), new Date(t0.getTime() + 33_000))).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("survives two refreshes racing", async () => {
    const { client, tokens } = await connect(ann);
    const both = await Promise.all([exchangeToken(db(), refreshForm(client, tokens.refresh_token)), exchangeToken(db(), refreshForm(client, tokens.refresh_token))]);
    expect(both[0].refresh_token).not.toBe(both[1].refresh_token);
    for (const t of both) expect(await authenticateAccessToken(db(), t.access_token)).not.toBeNull();
  });

  it("honors a narrower scope and refuses a wider one", async () => {
    const { client, tokens } = await connect(ann);
    const narrow = await exchangeToken(db(), refreshForm(client, tokens.refresh_token, { scope: "trips:read" }));
    expect(narrow.scope).toBe("trips:read");
    expect((await authenticateAccessToken(db(), narrow.access_token))?.scope).toBe("trips:read");
    await expect(exchangeToken(db(), refreshForm(client, narrow.refresh_token, { scope: "trips:write" }))).rejects.toMatchObject({ error: "invalid_scope" });
    await expect(exchangeToken(db(), refreshForm(client, narrow.refresh_token, { scope: "trips:read admin" }))).rejects.toMatchObject({ error: "invalid_scope" });
  });

  it("refuses another client's, an expired, a revoked or a malformed token", async () => {
    const { client, tokens } = await connect(ann);
    const other = (await register()).body as unknown as Client;
    await expect(exchangeToken(db(), refreshForm(other, tokens.refresh_token))).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(exchangeToken(db(), refreshForm(client, "nonsense"))).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(exchangeToken(db(), refreshForm(client, `fn_rt_${"B".repeat(43)}`))).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(exchangeToken(db(), new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id }))).rejects.toMatchObject({ error: "invalid_request" });
    await expect(exchangeToken(db(), refreshForm(client, tokens.refresh_token, { resource: "https://other.example/mcp" }))).rejects.toMatchObject({ error: "invalid_target" });
    const idle = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000);
    await expect(exchangeToken(db(), refreshForm(client, tokens.refresh_token), idle)).rejects.toMatchObject({ error: "invalid_grant" });
  });
});

describe("revoking", () => {
  it("ends the approval of an access or a refresh token, for the app that holds it", async () => {
    for (const kind of ["access_token", "refresh_token"] as const) {
      const { client, tokens } = await connect(ann);
      const res = await revokeRoute.POST(form("/oauth/revoke", { token: tokens[kind], client_id: client.client_id }));
      expect(res.status).toBe(200);
      expect(await authenticateAccessToken(db(), tokens.access_token)).toBeNull();
      await expect(exchangeToken(db(), refreshForm(client, tokens.refresh_token))).rejects.toMatchObject({ error: "invalid_grant" });
    }
  });

  it("does nothing for another app's token or an unknown one, and still answers 200", async () => {
    const { tokens } = await connect(ann);
    const other = (await register()).body as unknown as Client;
    expect((await revokeRoute.POST(form("/oauth/revoke", { token: tokens.access_token, client_id: other.client_id }))).status).toBe(200);
    expect((await revokeRoute.POST(form("/oauth/revoke", { token: `fn_at_${"C".repeat(43)}`, client_id: other.client_id }))).status).toBe(200);
    expect((await revokeRoute.POST(form("/oauth/revoke", { token: "garbage", client_id: other.client_id }))).status).toBe(200);
    expect(await authenticateAccessToken(db(), tokens.access_token)).not.toBeNull();
    expect((await revokeRoute.POST(form("/oauth/revoke", { client_id: other.client_id }))).status).toBe(400);
  });
});

describe("a person's connections", () => {
  it("lists their live approvals with what the app is allowed, and no one else's", async () => {
    await connect(ann, { allowChanges: false });
    await connect(ann);
    await connect(bob);
    session.actor = ann;
    const res = await connectionsRoute.GET(new Request(`${ORIGIN}/api/connector/connections`));
    expect(res.headers.get("cache-control")).toContain("no-store");
    const list = (await res.json()) as Array<{ id: string; appName: string; returnHost: string; canChange: boolean; lastUsedAt: string | null }>;
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.canChange).sort()).toEqual([false, true]);
    expect(list[0]).toMatchObject({ appName: "Claude", returnHost: "claude.ai" });
    expect(JSON.stringify(list)).not.toMatch(/fn_(at|rt|ac)_/);
    expect(await listConnections(db(), bob)).toHaveLength(1);
  });

  it("stops listing an approval once it is revoked or idle for 60 days", async () => {
    const { client, tokens } = await connect(ann);
    expect(await listConnections(db(), ann)).toHaveLength(1);
    expect(await listConnections(db(), ann, new Date(Date.now() + 61 * 24 * 60 * 60 * 1000))).toHaveLength(0);
    await revokeRoute.POST(form("/oauth/revoke", { token: tokens.refresh_token, client_id: client.client_id }));
    expect(await listConnections(db(), ann)).toHaveLength(0);
  });

  it("disconnects the person's own app at once, and another person's is 404", async () => {
    const mine = await connect(ann);
    const theirs = await connect(bob);
    const [connection] = await listConnections(db(), ann);
    const [bobsConnection] = await listConnections(db(), bob);
    session.actor = ann;
    const cross = await connectionRoute.DELETE(new Request(`${ORIGIN}/api/connector/connections/${bobsConnection!.id}`, { method: "DELETE", headers: { origin: ORIGIN } }), { params: Promise.resolve({ connectionId: bobsConnection!.id }) });
    expect(cross.status).toBe(404);
    expect(await authenticateAccessToken(db(), theirs.tokens.access_token)).not.toBeNull();
    const noOrigin = await connectionRoute.DELETE(new Request(`${ORIGIN}/api/connector/connections/${connection!.id}`, { method: "DELETE" }), { params: Promise.resolve({ connectionId: connection!.id }) });
    expect(noOrigin.status).toBe(403);
    const ok = await connectionRoute.DELETE(new Request(`${ORIGIN}/api/connector/connections/${connection!.id}`, { method: "DELETE", headers: { origin: ORIGIN } }), { params: Promise.resolve({ connectionId: connection!.id }) });
    expect(ok.status).toBe(204);
    expect(await authenticateAccessToken(db(), mine.tokens.access_token)).toBeNull();
    await expect(disconnect(db(), ann, connection!.id)).rejects.toMatchObject({ status: 404 });
    await expect(disconnect(db(), ann, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });

  it("goes with the account when it is deleted", async () => {
    const { tokens } = await connect(bob);
    expect(await authenticateAccessToken(db(), tokens.access_token)).not.toBeNull();
    await deleteAccount(db(), bob, []);
    expect(await authenticateAccessToken(db(), tokens.access_token)).toBeNull();
    for (const table of ["oauth_grants", "oauth_tokens", "oauth_codes"] as const) {
      expect(await db().selectFrom(table).selectAll().execute()).toHaveLength(0);
    }
  });
});

describe("pruning", () => {
  it("deletes what has expired for good, and keeps clients that have an approval", async () => {
    const { client } = await connect(ann);
    const idle = (await register()).body as unknown as Client;
    const fresh = (await register()).body as unknown as Client;
    const long = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db().updateTable("oauth_clients").set({ created_at: long }).where("id", "in", [client.client_id, idle.client_id]).execute();
    await db().updateTable("oauth_tokens").set({ expires_at: long }).execute();
    const { pruneExpired } = await import("@/server/modules/oauth/oauth.repository");
    await pruneExpired(db(), new Date());
    const clients = (await db().selectFrom("oauth_clients").select("id").execute()).map((c) => c.id).sort();
    expect(clients).toEqual([client.client_id, fresh.client_id].sort());
    expect(await db().selectFrom("oauth_tokens").selectAll().execute()).toHaveLength(0);
    expect(await db().selectFrom("oauth_grants").selectAll().execute()).toHaveLength(1);
    // An approval that ended a month ago goes, and then its now-unused client does too.
    await db().updateTable("oauth_grants").set({ revoked_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) }).execute();
    await pruneExpired(db(), new Date());
    expect(await db().selectFrom("oauth_grants").selectAll().execute()).toHaveLength(0);
    expect((await db().selectFrom("oauth_clients").select("id").execute()).map((c) => c.id)).toEqual([fresh.client_id]);
  });
});

describe("what leaves the server", () => {
  it("never logs a code or a token", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args.join(" ")));
    const { client, tokens } = await connect(ann);
    await exchangeToken(db(), refreshForm(client, tokens.refresh_token)).catch(() => undefined);
    await tokenRoute.POST(form("/oauth/token", { grant_type: "authorization_code", client_id: client.client_id, code: "fn_ac_x", redirect_uri: CLAUDE, code_verifier: "x" }));
    spy.mockRestore();
    expect(logged.join("\n")).not.toMatch(/fn_(at|rt|ac)_/);
  });

  it("derives every digest from the token itself", () => {
    const value = `fn_at_${"D".repeat(43)}`;
    expect(hashSecret(value).equals(createHash("sha256").update(value).digest())).toBe(true);
  });
});
