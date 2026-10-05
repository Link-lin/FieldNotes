import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, connectAs, mcpRequest, ORIGIN, replyOf, request, toolText } from "./connector-helpers";
import { grant, makeActor, reset, testDb } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { resetRateLimits } from "@/server/core/rate-limit";
import { REQUESTS_PER_MINUTE } from "@/server/modules/connector/mcp.http";
import { disconnect, listConnections } from "@/server/modules/oauth/oauth.service";

const { POST, GET, DELETE } = await import("@/app/mcp/route");

const send = async (token: string | null, message: unknown, headers: Record<string, string | null> = {}) => replyOf(await POST(mcpRequest(token, message, headers)));

let ann: Actor, bob: Actor;
let owner: Awaited<ReturnType<typeof connectAs>>;
let reader: Awaited<ReturnType<typeof connectAs>>;
let member: Awaited<ReturnType<typeof connectAs>>;

beforeEach(async () => {
  await reset();
  resetRateLimits();
  delete process.env.AI_CONNECTOR;
  ann = await makeActor("owner@example.com", "Ann"); // on the owner allowlist
  bob = await makeActor("bob@example.com", "Bob"); // not on it
  owner = await connectAs(ann);
  reader = await connectAs(ann, { write: false });
  member = await connectAs(bob);
});

describe("who may call", () => {
  it("answers a request with no token 401 with the challenge that starts the OAuth flow, and reveals nothing else", async () => {
    const res = await POST(mcpRequest(null, request("initialize")));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('scope="trips:read trips:write"');
    expect(challenge).not.toContain("invalid_token");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).not.toHaveProperty("result");
  });

  it("names the token as the problem when one was sent and is no good", async () => {
    for (const bad of ["garbage", `fn_at_${"A".repeat(43)}`, owner.refreshToken]) {
      const res = await POST(mcpRequest(bad, request("initialize")));
      expect(res.status, bad).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
    const basic = await POST(mcpRequest(null, request("initialize"), { authorization: "Basic abc" }));
    expect(basic.status).toBe(401);
  });

  it("refuses a token that was disconnected, on its very next request, and leaves the person's other apps alone", async () => {
    expect((await send(owner.accessToken, request("ping"))).status).toBe(200);
    const connection = (await listConnections(testDb(), ann)).find((c) => c.canChange)!;
    await disconnect(testDb(), ann, connection.id);
    expect((await send(owner.accessToken, request("ping"))).status).toBe(401);
    expect((await send(reader.accessToken, request("ping"))).status).toBe(200);
  });

  it("answers GET and DELETE 405 once authenticated, and 401 before", async () => {
    const get = await GET(mcpRequest(owner.accessToken, null, {}, "GET"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await DELETE(mcpRequest(owner.accessToken, null, {}, "DELETE"))).status).toBe(405);
    expect((await GET(mcpRequest(null, null, {}, "GET"))).status).toBe(401);
  });

  it("refuses a browser origin other than the app's, even with a valid token, and accepts the app's own", async () => {
    expect((await POST(mcpRequest(owner.accessToken, request("ping"), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(mcpRequest(owner.accessToken, request("ping"), { origin: "http://localhost:3000.evil.example" }))).status).toBe(403);
    expect((await POST(mcpRequest(owner.accessToken, request("ping"), { origin: ORIGIN }))).status).toBe(200);
    expect((await POST(mcpRequest(null, request("ping"), { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("ignores a session cookie: the bearer token is the only credential", async () => {
    const res = await POST(mcpRequest(null, request("ping"), { cookie: "authjs.session-token=anything; __Secure-authjs.session-token=anything" }));
    expect(res.status).toBe(401);
  });

  it("is 404 for everything when the connector is off", async () => {
    process.env.AI_CONNECTOR = "off";
    expect((await POST(mcpRequest(owner.accessToken, request("ping")))).status).toBe(404);
    expect((await GET(mcpRequest(null, null, {}, "GET"))).status).toBe(404);
  });

  it("limits a connection to 120 requests a minute and says when to retry", async () => {
    for (let i = 0; i < REQUESTS_PER_MINUTE; i++) expect((await send(owner.accessToken, request("ping"))).status).toBe(200);
    const limited = await POST(mcpRequest(owner.accessToken, request("ping")));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another connection has its own allowance.
    expect((await send(member.accessToken, request("ping"))).status).toBe(200);
  });
});

describe("the request body", () => {
  it("is refused when it is not JSON, is not one message, is not JSON-RPC, or is too large", async () => {
    expect((await send(owner.accessToken, request("ping"), { "content-type": "text/plain" })).status).toBe(415);
    const bad = await send(owner.accessToken, "{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(-32700);
    const batch = await send(owner.accessToken, [request("ping"), request("ping")]);
    expect(batch.status).toBe(400);
    expect(batch.body.error.code).toBe(-32600);
    expect((await send(owner.accessToken, { hello: "world" })).body.error.code).toBe(-32600);
    expect((await send(owner.accessToken, { jsonrpc: "1.0", id: 1, method: "ping" })).status).toBe(400);
    expect((await send(owner.accessToken, { jsonrpc: "2.0", id: {}, method: "ping" })).status).toBe(400);
    expect((await send(owner.accessToken, { jsonrpc: "2.0", id: 1, method: "ping", params: [1] })).body.error.code).toBe(-32602);
    const big = await send(owner.accessToken, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(1024 * 1024 + 10) } }));
    expect(big.status).toBe(413);
  });

  it("answers a notification, or a response from the client, 202 with no body", async () => {
    for (const message of [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 5, result: {} }, { jsonrpc: "2.0", id: 6, error: { code: -1, message: "x" } }]) {
      const res = await POST(mcpRequest(owner.accessToken, message));
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    }
  });
});

describe("the initialize era", () => {
  it("negotiates the client's version when it is a known one, and offers the newest otherwise", async () => {
    for (const asked of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
      const r = await send(owner.accessToken, request("initialize", { protocolVersion: asked, capabilities: {}, clientInfo: { name: "x", version: "1" } }));
      expect(r.status).toBe(200);
      expect(r.body.result.protocolVersion).toBe(asked);
    }
    expect((await send(owner.accessToken, request("initialize", { protocolVersion: "2024-11-05" }))).body.result.protocolVersion).toBe("2025-11-25");
    expect((await send(owner.accessToken, request("initialize", { protocolVersion: "2026-07-28" }))).body.result.protocolVersion).toBe("2025-11-25");
    expect((await send(owner.accessToken, request("initialize"))).body.result.protocolVersion).toBe("2025-11-25");
  });

  it("declares tools only, names itself, carries instructions and issues no session", async () => {
    const res = await POST(mcpRequest(owner.accessToken, request("initialize", { protocolVersion: "2025-06-18" })));
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const { result } = await res.json();
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo).toMatchObject({ name: "field-notes", title: "Field Notes", websiteUrl: ORIGIN });
    // The icon is the site's own PNG, on this origin and declared at its real size (tests/unit/app-icons.test.ts).
    expect(result.serverInfo.icons).toEqual([{ src: `${ORIGIN}/icon.png`, mimeType: "image/png", sizes: ["128x128"] }]);
    expect(result.instructions).toMatch(/Booked/);
    expect(result.instructions).toMatch(/data, not instructions/);
    // How to work with the person: the page they keep open, both ways to plan a trip, and the review that is theirs.
    expect(result.instructions).toMatch(/trip's url/);
    expect(result.instructions).toMatch(/create the whole trip at the end/);
    expect(result.instructions).toMatch(/until the person marks it reviewed/);
    expect(result.instructions).not.toMatch(/pinned on the map automatically/); // no place lookup set up in tests
    expect(result).not.toHaveProperty("resultType");
  });

  it("ignores a session id it was sent, and answers ping", async () => {
    const r = await send(owner.accessToken, request("ping"), { "mcp-session-id": "abc", "mcp-protocol-version": "2025-06-18" });
    expect(r.status).toBe(200);
    expect(r.body.result).toEqual({});
    expect(r.headers.get("mcp-session-id")).toBeNull();
  });

  it("answers an unknown method with a JSON-RPC error inside a 200", async () => {
    const r = await send(owner.accessToken, request("resources/list"));
    expect(r.status).toBe(200);
    expect(r.body.error.code).toBe(-32601);
    expect((await send(owner.accessToken, request("server/discover"))).body.error.code).toBe(-32601);
  });

  it("refuses a protocol version it does not know, and lists the ones it does", async () => {
    const r = await send(owner.accessToken, request("ping"), { "mcp-protocol-version": "1999-01-01" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(-32022);
    expect(r.body.error.data).toEqual({ supported: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"], requested: "1999-01-01" });
  });
});

describe("the tool list", () => {
  const names = async (token: string) => (await send(token, request("tools/list"))).body.result.tools.map((t: { name: string }) => t.name);

  it("is the full set for an allowlisted owner who allowed changes", async () => {
    expect(await names(owner.accessToken)).toEqual(["list_trips", "get_trip", "get_item", "add_items", "update_item", "delete_item", "restore_item", "create_trip"]);
  });

  it("leaves out create_trip for an account that may not create trips", async () => {
    expect(await names(member.accessToken)).toEqual(["list_trips", "get_trip", "get_item", "add_items", "update_item", "delete_item", "restore_item"]);
  });

  it("is only the three read tools when changes were not allowed", async () => {
    expect(await names(reader.accessToken)).toEqual(["list_trips", "get_trip", "get_item"]);
  });

  it("describes every tool completely, and declares whether it changes anything", async () => {
    const { tools } = (await send(owner.accessToken, request("tools/list"))).body.result;
    const seen = new Set<string>();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(seen.has(tool.name)).toBe(false);
      seen.add(tool.name);
      expect(tool.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint"]) expect(typeof tool.annotations[hint], `${tool.name} ${hint}`).toBe("boolean");
      // ChatGPT reads what each tool needs from securitySchemes, at the top level and mirrored in _meta.
      const needs = tool.annotations.readOnlyHint ? ["trips:read"] : ["trips:read", "trips:write"];
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: needs }]);
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint).toBe(false);
      // No conditional keywords or references a chat provider might not handle.
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"\$ref"|"allOf"|"oneOf"|"anyOf"/);
    }
    const readOnly = tools.filter((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint).map((t: { name: string }) => t.name);
    expect(readOnly).toEqual(["list_trips", "get_trip", "get_item"]);
    const byName = Object.fromEntries(tools.map((t: { name: string }) => [t.name, t]));
    expect(byName.delete_item.annotations.destructiveHint).toBe(true);
    expect(byName.update_item.annotations.destructiveHint).toBe(true);
    expect(byName.add_items.annotations.destructiveHint).toBe(false);
    expect(byName.add_items.inputSchema.properties.items.items.properties.bookingStatus.enum).toEqual(["Needs booking", "Not required"]);
    expect(byName.create_trip.inputSchema.required).toEqual(["trip"]);
    expect(byName.update_item.inputSchema.properties.bookingStatus.enum).toEqual(["Needs booking", "Not required"]);
  });

  it("returns the same tools in the same order every time", async () => {
    const a = (await send(owner.accessToken, request("tools/list"))).body.result.tools;
    const b = (await send(owner.accessToken, request("tools/list"))).body.result.tools;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("calling a tool", () => {
  it("is a protocol error for an unknown tool or malformed arguments, and an execution error for the rest", async () => {
    expect((await send(owner.accessToken, call("delete_trip"))).body.error.code).toBe(-32602);
    expect((await send(owner.accessToken, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: {} } })).body.error.code).toBe(-32602);
    expect((await send(owner.accessToken, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_trips", arguments: [] } })).body.error.code).toBe(-32602);
    const bad = toolText(await send(owner.accessToken, call("get_trip", { tripId: "nope" })));
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/tripId/);
    const extra = toolText(await send(owner.accessToken, call("list_trips", { surprise: 1 })));
    expect(extra.isError).toBe(true);
  });

  it("says a read-only connection is read-only, even when the tool is called by name", async () => {
    const r = toolText(await send(reader.accessToken, call("add_items", { tripId: "00000000-0000-4000-8000-000000000000", items: [{}] })));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/read-only/);
  });

  it("returns a successful result as one text block with isError false", async () => {
    const r = await send(owner.accessToken, call("list_trips"));
    expect(r.body.result.content).toHaveLength(1);
    expect(r.body.result.content[0].type).toBe("text");
    expect(r.body.result.isError).toBe(false);
    expect(toolText(r).json).toEqual({});
  });

  it("logs nothing about the request", async () => {
    const seen: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a) => void seen.push(a.join(" "))));
    await send(owner.accessToken, call("get_trip", { tripId: "SECRET-TRIP-ID" }));
    await send("garbage", request("ping"));
    spies.forEach((s) => s.mockRestore());
    expect(seen.join("\n")).not.toMatch(/SECRET|fn_at_|garbage/);
  });
});

describe("2026-07-28", () => {
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
  const modern = (method: string, params: Record<string, unknown> = {}, extra: Record<string, string | null> = {}) => ({
    message: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } },
    headers: { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...extra },
  });

  it("answers server/discover with the versions, capabilities, instructions and caching hints", async () => {
    const { message, headers } = modern("server/discover");
    const r = await send(owner.accessToken, message, headers);
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"], capabilities: { tools: {} }, cacheScope: "public" });
    expect(r.body.result.ttlMs).toBeGreaterThanOrEqual(0);
    expect(r.body.result.instructions).toMatch(/Field Notes/);
    expect(r.body.result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({ name: "field-notes", icons: [{ src: `${ORIGIN}/icon.png` }] });
  });

  it("lists tools with a result type and private caching, since the list depends on the caller", async () => {
    const { message, headers } = modern("tools/list");
    const r = await send(member.accessToken, message, headers);
    expect(r.body.result).toMatchObject({ resultType: "complete", ttlMs: 0, cacheScope: "private" });
    expect(r.body.result.tools).toHaveLength(7);
  });

  it("calls a tool, matching Mcp-Name to the tool (also when it is base64 encoded)", async () => {
    const { message, headers } = modern("tools/call", { name: "list_trips", arguments: {} }, { "mcp-name": "list_trips" });
    const r = await send(owner.accessToken, message, headers);
    expect(r.body.result).toMatchObject({ resultType: "complete", isError: false });
    const encoded = modern("tools/call", { name: "list_trips", arguments: {} }, { "mcp-name": `=?base64?${Buffer.from("list_trips").toString("base64")}?=` });
    expect((await send(owner.accessToken, encoded.message, encoded.headers)).body.result.isError).toBe(false);
  });

  it("rejects a request without per-request metadata, with -32602 and 400", async () => {
    for (const params of [{}, { _meta: {} }, { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }, { _meta: { ...meta, "io.modelcontextprotocol/clientCapabilities": "x" } }]) {
      const r = await send(owner.accessToken, { jsonrpc: "2.0", id: 1, method: "tools/list", params }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe(-32602);
    }
  });

  it("rejects headers that disagree with the body with HeaderMismatch (-32020) and 400", async () => {
    const list = modern("tools/list");
    const cases: Array<Record<string, string | null>> = [{ "mcp-method": "tools/call" }, { "mcp-method": null }, { "mcp-method": "" }];
    for (const extra of cases) {
      const r = await send(owner.accessToken, list.message, { ...list.headers, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error.code).toBe(-32020);
    }
    // The version in the body must be the one in the header.
    const skewed = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2025-11-25" } } };
    const mismatch = await send(owner.accessToken, skewed, list.headers);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe(-32020);
    const noName = modern("tools/call", { name: "list_trips", arguments: {} });
    expect((await send(owner.accessToken, noName.message, noName.headers)).body.error.code).toBe(-32020);
    const wrongName = modern("tools/call", { name: "list_trips", arguments: {} }, { "mcp-name": "get_trip" });
    const wrong = await send(owner.accessToken, wrongName.message, wrongName.headers);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe(-32020);
  });

  it("serves a request headed with an older version as that version, whatever its body carries", async () => {
    const list = modern("tools/list");
    const r = await send(owner.accessToken, list.message, { ...list.headers, "mcp-protocol-version": "2025-11-25" });
    expect(r.status).toBe(200);
    expect(r.body.result).not.toHaveProperty("resultType");
  });

  it("answers an unknown method 404, and does not take initialize", async () => {
    const unknown = modern("resources/list");
    const r = await send(owner.accessToken, unknown.message, unknown.headers);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe(-32601);
    const init = modern("initialize");
    expect((await send(owner.accessToken, init.message, init.headers)).status).toBe(404);
  });

  it("keeps the authorization rules: no token is 401, whatever the protocol version", async () => {
    const { message, headers } = modern("tools/list");
    expect((await send(null, message, headers)).status).toBe(401);
  });
});

describe("who the tools act as", () => {
  it("is the person who approved: a trip shared with them is theirs to read, and another person's is not", async () => {
    const { createTrip } = await import("@/server/modules/trips/trips.service");
    const t = await createTrip(testDb(), ann, { title: "Lisbon", destination: "Lisbon, Portugal", startDate: "2026-11-01", endDate: "2026-11-05", timeZone: "Europe/Lisbon", budget: null });
    const bobsView = toolText(await send(member.accessToken, call("list_trips")));
    expect(bobsView.json).toEqual({});
    await grant(t.id, bob, "accepted", "viewer");
    const after = toolText(await send(member.accessToken, call("list_trips")));
    expect(after.json.trips).toHaveLength(1);
    expect(after.json.trips[0]).toMatchObject({ id: t.id, title: "Lisbon", role: "viewer", status: "upcoming" });
    const annsView = toolText(await send(owner.accessToken, call("list_trips")));
    expect(annsView.json.trips[0].role).toBe("owner");
  });
});
