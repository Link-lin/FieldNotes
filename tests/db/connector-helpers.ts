import { randomBytes } from "node:crypto";
import { testDb } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { codeChallengeFor } from "@/server/modules/oauth/oauth.rules";
import { decideAuthorization, exchangeToken, registerClient } from "@/server/modules/oauth/oauth.service";

export const ORIGIN = "http://localhost:3000";
export const RESOURCE = `${ORIGIN}/mcp`;
export const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

/** Connects an app as `actor` through the authorization server's own functions (the whole OAuth flow), returning its tokens. */
export async function connectAs(actor: Actor, opts: { write?: boolean; name?: string } = {}) {
  const db = testDb();
  const client = await registerClient(db, { client_name: opts.name ?? "Claude", redirect_uris: [CLAUDE] });
  const verifier = randomBytes(32).toString("base64url");
  const { redirectTo } = await decideAuthorization(
    db,
    actor,
    {
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      response_type: "code",
      scope: "trips:read trips:write",
      code_challenge: codeChallengeFor(verifier),
      code_challenge_method: "S256",
      resource: RESOURCE,
    },
    "allow",
    opts.write ?? true,
  );
  const code = new URL(redirectTo).searchParams.get("code")!;
  const tokens = await exchangeToken(db, new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CLAUDE, code_verifier: verifier }));
  return { clientId: client.client_id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope };
}

export type Reply = { status: number; headers: Headers; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One POST to /mcp. `headers` overrides the defaults; pass `null` for a header to leave it out. */
export function mcpRequest(token: string | null, message: unknown, headers: Record<string, string | null> = {}, method = "POST"): Request {
  const base: Record<string, string | null> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
  const final: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== null) final[key] = value;
  return new Request(RESOURCE, { method, headers: final, body: method === "POST" ? (typeof message === "string" ? message : JSON.stringify(message)) : undefined });
}

export async function replyOf(res: Response): Promise<Reply> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

let nextId = 1;
export const call = (name: string, args: unknown = {}) => ({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
export const request = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: nextId++, method, params });

/** The text of a tool result, parsed when it is JSON. */
export function toolText(reply: Reply): { isError: boolean; text: string; json: any } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const result = reply.body?.result;
  const text: string = result?.content?.[0]?.text ?? "";
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: result?.isError === true, text, json };
}
