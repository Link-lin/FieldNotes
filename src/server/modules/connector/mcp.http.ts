import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/server/core/db/client";
import { appOrigin, connectorEnabled } from "@/server/core/env";
import { connectorOff, OAuthError, readLimitedText } from "@/server/core/http/oauth";
import { errorTag } from "@/server/core/http/respond";
import { rateLimit } from "@/server/core/rate-limit";
import { bearerChallenge } from "@/server/modules/oauth/oauth.metadata";
import { authenticateAccessToken } from "@/server/modules/oauth/oauth.service";
import { handleMcpMessage, type McpReply } from "./mcp.protocol";

/**
 * `/mcp` (technical design: AI connector): the HTTP side of the MCP endpoint. Order matters: the browser-origin rule, then
 * the bearer token (no cookie is ever read), then the method, the request rate, and only then the body.
 */

const MAX_BODY_BYTES = 1024 * 1024;
export const REQUESTS_PER_MINUTE = 120;

const headers = (extra: Record<string, string> = {}) => ({ "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
const rpc = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), { status, headers: headers(extra) });

function unauthorized(sentToken: boolean): Response {
  return new Response(JSON.stringify({ error: sentToken ? "invalid_token" : "unauthorized", error_description: "Authorize Field Notes first." }), {
    status: 401,
    headers: headers({ "WWW-Authenticate": bearerChallenge(sentToken) }),
  });
}

function answer(reply: McpReply): Response {
  if (reply.body === undefined) return new Response(null, { status: reply.status, headers: { "Cache-Control": "no-store" } });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: headers() });
}

export async function handleMcpHttp(req: Request, now = new Date()): Promise<Response> {
  if (!connectorEnabled()) return connectorOff();
  try {
    // Browsers send Origin; a connector's provider calls from a server and sends none. Anything but our own site is refused.
    const origin = req.headers.get("origin");
    if (origin !== null && origin !== appOrigin()) return rpc(403, -32600, "This origin is not allowed.");

    const authorization = req.headers.get("authorization");
    const token = authorization ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
    const session = token ? await authenticateAccessToken(getDb(), token, now) : null;
    if (!session) return unauthorized(Boolean(authorization));

    if (req.method !== "POST") return rpc(405, -32600, "Use POST.", { Allow: "POST" });
    const limit = rateLimit(`mcp:${session.grantId}`, REQUESTS_PER_MINUTE, 60_000, now.getTime());
    if (!limit.ok) return rpc(429, -32600, "Too many requests. Slow down.", { "Retry-After": String(limit.retryAfterSeconds) });
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("json")) return rpc(415, -32600, "Send application/json.");

    let body: unknown;
    try {
      body = JSON.parse(await readLimitedText(req, MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof OAuthError) return rpc(413, -32600, "That request is too large.");
      return rpc(400, -32700, "The body is not valid JSON.");
    }

    return answer(
      await handleMcpMessage(
        { db: getDb(), actor: session.actor, scope: session.scope, now },
        { protocolVersion: req.headers.get("mcp-protocol-version"), method: req.headers.get("mcp-method"), name: req.headers.get("mcp-name") },
        body,
      ),
    );
  } catch (err) {
    const requestId = randomUUID();
    console.error(`[${requestId}] ${errorTag(err)}`);
    return rpc(500, -32603, `Something went wrong. (Reference ${requestId})`);
  }
}
