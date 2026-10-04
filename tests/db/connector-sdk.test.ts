import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { CLAUDE, ORIGIN, RESOURCE } from "./connector-helpers";
import { grant, makeActor, reset, testDb } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { resetRateLimits } from "@/server/core/rate-limit";
import { createTrip } from "@/server/modules/trips/trips.service";
import { decideAuthorization, disconnect, listConnections } from "@/server/modules/oauth/oauth.service";

/*
 * The official MCP client, run against the real route handlers through an in-process fetch: it discovers the server from
 * the 401, registers itself, goes through PKCE and consent, calls tools and refreshes an expired token. This is the
 * closest thing to Claude or ChatGPT in the test suite; the client is a dev dependency used only here.
 */

const mcp = await import("@/app/mcp/route");
const resourceDoc = await import("@/app/.well-known/oauth-protected-resource/mcp/route");
const resourceRootDoc = await import("@/app/.well-known/oauth-protected-resource/route");
const serverDoc = await import("@/app/.well-known/oauth-authorization-server/route");
const register = await import("@/app/oauth/register/route");
const token = await import("@/app/oauth/token/route");
const revoke = await import("@/app/oauth/revoke/route");

const seen: string[] = [];
async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  seen.push(`${req.method} ${url.pathname}`);
  const handlers: Record<string, Partial<Record<string, (r: Request) => Promise<Response> | Response>>> = {
    "/mcp": { POST: mcp.POST, GET: mcp.GET, DELETE: mcp.DELETE },
    "/.well-known/oauth-protected-resource/mcp": { GET: () => resourceDoc.GET() },
    "/.well-known/oauth-protected-resource": { GET: () => resourceRootDoc.GET() },
    "/.well-known/oauth-authorization-server": { GET: () => serverDoc.GET() },
    "/oauth/register": { POST: register.POST },
    "/oauth/token": { POST: token.POST },
    "/oauth/revoke": { POST: revoke.POST },
  };
  const handler = handlers[url.pathname]?.[req.method];
  return handler ? handler(req) : new Response("not found", { status: 404 });
}

/** A client that remembers what the server gave it, and lets "the person" approve when asked to authorize. */
class TestProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = "";
  authorizationUrl: URL | undefined;
  registrations = 0;
  get redirectUrl() {
    return CLAUDE;
  }
  get clientMetadata() {
    return { client_name: "SDK test client", redirect_uris: [CLAUDE], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() {
    return "state-123";
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.registrations += 1;
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t: OAuthTokens) {
    this.saved = t;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "tokens") this.saved = undefined;
    if (scope === "all" || scope === "client") this.info = undefined;
  }
}

/** Connects a client; when the server asks for authorization, "the person" approves and the client finishes. */
async function connectClient(provider: TestProvider, person: Actor, allowChanges = true) {
  const make = () => {
    const client = new Client({ name: "sdk-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: provider, fetch: appFetch });
    return { client, transport };
  };
  let { client, transport } = make();
  try {
    await client.connect(transport);
    return client;
  } catch (err) {
    if (!(err instanceof UnauthorizedError) || !provider.authorizationUrl) throw err;
  }
  const params = Object.fromEntries(provider.authorizationUrl.searchParams) as Record<string, string>;
  const { redirectTo } = await decideAuthorization(testDb(), person, params, "allow", allowChanges);
  const back = new URL(redirectTo);
  expect(back.origin + back.pathname).toBe(CLAUDE);
  expect(back.searchParams.get("state")).toBe("state-123");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  await transport.finishAuth(back.searchParams.get("code")!);
  ({ client, transport } = make());
  await client.connect(transport);
  return client;
}

let ann: Actor;
let tripId: string;
beforeEach(async () => {
  await reset();
  resetRateLimits();
  seen.length = 0;
  ann = await makeActor("owner@example.com", "Ann");
  tripId = (await createTrip(testDb(), ann, { title: "Lisbon", destination: "Lisbon, Portugal", startDate: "2026-11-01", endDate: "2026-11-05", timeZone: "Europe/Lisbon", budget: null })).id;
});

const text = (result: unknown): string => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? "");

describe("the MCP SDK client", () => {
  it("discovers the server from the 401, registers itself, goes through consent and PKCE, and lists the tools", async () => {
    const provider = new TestProvider();
    const client = await connectClient(provider, ann);
    // It followed the protocol: the 401, the resource document, the authorization server document, registration, the token exchange.
    expect(seen).toEqual(expect.arrayContaining(["POST /mcp", "GET /.well-known/oauth-protected-resource/mcp", "GET /.well-known/oauth-authorization-server", "POST /oauth/register", "POST /oauth/token"]));
    expect(provider.registrations).toBe(1);
    expect(provider.authorizationUrl!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(provider.authorizationUrl!.searchParams.get("resource")).toBe(RESOURCE);
    expect(provider.saved).toMatchObject({ token_type: "Bearer" });
    expect(provider.saved!.refresh_token).toMatch(/^fn_rt_/);
    expect(client.getServerVersion()).toMatchObject({ name: "field-notes" });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
    expect(client.getInstructions()).toMatch(/Field Notes/);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_trips", "get_trip", "get_item", "add_items", "update_item", "delete_item", "restore_item", "create_trip"]);
    await client.close();
  });

  it("shows the person the app's name and what it asked for in the connection it created", async () => {
    await connectClient(new TestProvider(), ann);
    const [connection] = await listConnections(testDb(), ann);
    expect(connection).toMatchObject({ appName: "SDK test client", returnHost: "claude.ai", canChange: true });
  });

  it("calls the tools as the person: reads a trip, adds an item, changes it and deletes it", async () => {
    const client = await connectClient(new TestProvider(), ann);
    const listed = JSON.parse(text(await client.callTool({ name: "list_trips", arguments: {} })));
    expect(listed.trips).toEqual([expect.objectContaining({ id: tripId, title: "Lisbon", role: "owner" })]);

    const added = JSON.parse(text(await client.callTool({ name: "add_items", arguments: { tripId, items: [{ type: "activity", title: "Alfama walk", bookingStatus: "Not required", localDate: "2026-11-02", localTime: "10:00" }] } })));
    const id = added.added[0].id as string;
    expect(added.added[0]).toMatchObject({ title: "Alfama walk", addedBy: "ai" });

    const moved = await client.callTool({ name: "update_item", arguments: { tripId, itemId: id, localTime: "11:00" } });
    expect(moved.isError).toBeFalsy();
    expect(JSON.parse(text(moved)).item.localTime).toBe("11:00");

    const rejected = await client.callTool({ name: "update_item", arguments: { tripId, itemId: id, bookingStatus: "Booked" } });
    expect(rejected.isError).toBe(true);

    const trip = JSON.parse(text(await client.callTool({ name: "get_trip", arguments: { tripId } })));
    expect(trip.items).toHaveLength(1);
    await client.callTool({ name: "delete_item", arguments: { tripId, itemId: id } });
    expect(JSON.parse(text(await client.callTool({ name: "get_trip", arguments: { tripId } }))).items).toEqual([]);
    await client.close();
  });

  it("refreshes an expired access token by itself and carries on", async () => {
    const provider = new TestProvider();
    const client = await connectClient(provider, ann);
    const before = provider.saved!;
    await testDb().deleteFrom("oauth_tokens").where("kind", "=", "access").execute(); // the access token "expires"
    const result = await client.callTool({ name: "list_trips", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(provider.saved!.access_token).not.toBe(before.access_token);
    expect(provider.saved!.refresh_token).not.toBe(before.refresh_token);
    expect(seen.filter((s) => s === "POST /oauth/token").length).toBeGreaterThanOrEqual(2);
    // The old refresh token is spent, the new one works.
    expect(JSON.parse(text(await client.callTool({ name: "list_trips", arguments: {} }))).trips).toHaveLength(1);
    await client.close();
  });

  it("is sent back to authorization when the person disconnects the app", async () => {
    const provider = new TestProvider();
    const client = await connectClient(provider, ann);
    const [connection] = await listConnections(testDb(), ann);
    await disconnect(testDb(), ann, connection!.id);
    provider.authorizationUrl = undefined;
    await expect(client.callTool({ name: "list_trips", arguments: {} })).rejects.toThrow();
    await client.close().catch(() => undefined);
  });

  it("gets only the read tools when the person did not allow changes, and cannot change anything", async () => {
    const client = await connectClient(new TestProvider(), ann, false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_trips", "get_trip", "get_item"]);
    const attempt = await client.callTool({ name: "add_items", arguments: { tripId, items: [{ type: "other", title: "x", bookingStatus: "Not required" }] } });
    expect(attempt.isError).toBe(true);
    expect(text(attempt)).toMatch(/read-only/);
    await client.close();
  });

  it("is a viewer's own eyes: reads a trip shared with it and cannot change it", async () => {
    const vera = await makeActor("vera@example.com", "Vera");
    await grant(tripId, vera, "accepted", "viewer");
    const client = await connectClient(new TestProvider(), vera);
    expect(JSON.parse(text(await client.callTool({ name: "list_trips", arguments: {} }))).trips[0]).toMatchObject({ role: "viewer" });
    const attempt = await client.callTool({ name: "add_items", arguments: { tripId, items: [{ type: "other", title: "x", bookingStatus: "Not required" }] } });
    expect(attempt.isError).toBe(true);
    expect(text(attempt)).toMatch(/isn't allowed/);
    await client.close();
  });
});

describe("the tool schemas", () => {
  it("are real JSON Schema, accept what the examples send, and refuse what the rules forbid", async () => {
    const client = await connectClient(new TestProvider(), ann);
    const { tools } = await client.listTools();
    const validator = new AjvJsonSchemaValidator();
    const byName = Object.fromEntries(tools.map((t) => [t.name, validator.getValidator(t.inputSchema)]));
    const item = { type: "meal", title: "Dinner", bookingStatus: "Not required", localDate: "2026-11-02", localTime: "20:00", plannedPrice: { amount: "45.50", currency: "EUR" } };
    const valid = (name: string, args: unknown) => (byName[name]!(args) as { valid: boolean }).valid;
    expect(valid("add_items", { tripId, items: [item] })).toBe(true);
    expect(valid("add_items", { tripId, items: [{ ...item, bookingStatus: "Booked" }] })).toBe(false);
    expect(valid("add_items", { tripId, items: [{ ...item, mapUrl: "https://x.example" }] })).toBe(false);
    expect(valid("add_items", { tripId, items: [] })).toBe(false);
    expect(valid("add_items", { tripId: "nope", items: [item] })).toBe(false);
    expect(valid("update_item", { tripId, itemId: tripId, localTime: "09:00", location: null, plannedPrice: { amount: "1", currency: "EUR" } })).toBe(true);
    expect(valid("update_item", { tripId, itemId: tripId, bookingStatus: "Booked" })).toBe(false);
    expect(valid("create_trip", { trip: { title: "T", destination: "D", startDate: "2027-01-01", endDate: "2027-01-02", timeZone: "UTC" }, items: [item] })).toBe(true);
    expect(valid("create_trip", { trip: { title: "T" } })).toBe(false);
    expect(valid("list_trips", {})).toBe(true);
    expect(valid("list_trips", { x: 1 })).toBe(false);
    await client.close();
  });
});

describe("what the client never sees", () => {
  it("is nothing about a trip before it is authorized", async () => {
    const res = await appFetch(RESOURCE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/Lisbon|trip/i);
    vi.restoreAllMocks();
  });
});
