import "server-only";
import { appOrigin } from "@/server/core/env";
import { callTool, INSTRUCTIONS, listTools, type ToolContext } from "./mcp.tools";

/*
 * The MCP protocol subset the connector speaks (technical design: AI connector), over Streamable HTTP without sessions or
 * streams: JSON-RPC messages in, one JSON-RPC answer out. It serves two eras by the headers a request carries: the
 * initialize era (2025-03-26 to 2025-11-25, which Claude and ChatGPT use today) and 2026-07-28, where every request
 * brings its own version and capabilities. It knows nothing about HTTP authentication; `mcp.http.ts` does that first.
 */

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS] as const;

const SERVER_INFO = { name: "field-notes", version: "1.0.0" };
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** What the HTTP layer read from the request's headers. */
export type McpHeaders = { protocolVersion: string | null; method: string | null; name: string | null };
export type McpReply = { status: number; body?: unknown };

type Id = string | number | null;
const rpcError = (id: Id, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** `=?base64?…?=` is how a header carries a value that is not plain ASCII; decode it before comparing. */
function headerValue(value: string | null): string | null {
  const m = value === null ? null : /^=\?base64\?(.*)\?=$/.exec(value);
  return m ? Buffer.from(m[1]!, "base64").toString("utf8") : value;
}

/**
 * What the server calls itself, which a chat app shows beside its tools: the name, the site and an icon. The icon is the
 * site's own small PNG (`src/app/icon.png`), on this origin as the spec asks, and public, because the app's servers fetch it.
 */
function serverInfo() {
  const origin = appOrigin();
  return { ...SERVER_INFO, title: "Field Notes", websiteUrl: origin, icons: [{ src: `${origin}/icon.png`, mimeType: "image/png", sizes: ["128x128"] }] };
}

const idOf = (body: unknown): Id => (record(body) && (typeof body.id === "string" || typeof body.id === "number") ? body.id : null);

export async function handleMcpMessage(ctx: ToolContext, headers: McpHeaders, body: unknown): Promise<McpReply> {
  const version = headers.protocolVersion;
  if (version !== null && !(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    return { status: 400, body: rpcError(idOf(body), -32022, "Unsupported protocol version", { supported: [...SUPPORTED_VERSIONS], requested: version }) };
  }
  const modern = version === MODERN_VERSION;

  if (Array.isArray(body) || !record(body) || body.jsonrpc !== "2.0") {
    return { status: 400, body: rpcError(null, -32600, "Send one JSON-RPC 2.0 message per request.") };
  }
  if (typeof body.method !== "string") {
    // A response from the client to something it was asked: nothing here asks, so accept and ignore it.
    return "result" in body || "error" in body ? { status: 202 } : { status: 400, body: rpcError(idOf(body), -32600, "The message has no method.") };
  }
  if (!("id" in body)) return { status: 202 }; // a notification
  if (typeof body.id !== "string" && typeof body.id !== "number") return { status: 400, body: rpcError(null, -32600, "The id must be a string or a number.") };
  const id = body.id;
  const method = body.method;
  const params = body.params === undefined ? {} : body.params;
  if (!record(params)) return { status: modern ? 400 : 200, body: rpcError(id, -32602, "params must be an object.") };

  if (modern) {
    const bad = modernRequestProblem(headers, method, params);
    if (bad) return { status: 400, body: rpcError(id, bad.code, bad.message) };
  }

  const reply = (result: Record<string, unknown>): McpReply => ({
    status: 200,
    body: { jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result, _meta: { ...(record(result._meta) ? result._meta : {}), [META_SERVER_INFO]: serverInfo() } } : result },
  });
  const notFound = (): McpReply => ({ status: modern ? 404 : 200, body: rpcError(id, -32601, `Method not found: ${method}`) });

  switch (method) {
    case "initialize": {
      if (modern) return notFound();
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      const protocolVersion = asked && (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: serverInfo(), instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "server/discover":
      if (!modern) return notFound();
      return reply({ supportedVersions: [...SUPPORTED_VERSIONS], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 300_000, cacheScope: "public" });
    case "tools/list":
      return reply({ tools: listTools(ctx), ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) });
    case "tools/call": {
      if (typeof params.name !== "string" || (params.arguments !== undefined && !record(params.arguments))) {
        return { status: modern ? 400 : 200, body: rpcError(id, -32602, "tools/call needs a tool name and an arguments object.") };
      }
      const result = await callTool(ctx, params.name, params.arguments);
      if (!result) return { status: 200, body: rpcError(id, -32602, `Unknown tool: ${params.name}`) };
      return reply({ content: [{ type: "text", text: result.text }], isError: result.isError === true });
    }
    default:
      return notFound();
  }
}

/** The checks 2026-07-28 adds: per-request `_meta`, and headers that must agree with the body. */
function modernRequestProblem(headers: McpHeaders, method: string, params: Record<string, unknown>): { code: number; message: string } | null {
  const meta = params._meta;
  if (!record(meta) || typeof meta[META_VERSION] !== "string" || !record(meta[META_CAPABILITIES])) {
    return { code: -32602, message: `Every request needs _meta with ${META_VERSION} and ${META_CAPABILITIES}.` };
  }
  if (meta[META_VERSION] !== headers.protocolVersion) return { code: -32020, message: "Header mismatch: MCP-Protocol-Version does not match the protocol version in _meta." };
  if (headerValue(headers.method) !== method) return { code: -32020, message: "Header mismatch: Mcp-Method is missing or does not match the method." };
  if (method === "tools/call" && headerValue(headers.name) !== params.name) return { code: -32020, message: "Header mismatch: Mcp-Name is missing or does not match the tool name." };
  return null;
}
