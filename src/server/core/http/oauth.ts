import "server-only";
import { randomUUID } from "node:crypto";
import { connectorEnabled } from "@/server/core/env";
import { HttpError } from "./errors";
import { errorTag } from "./respond";

/**
 * Responses for the AI connector's machine routes (technical design: AI connector). They answer apps, not the
 * browser UI, so errors use OAuth's own body, and nothing is cached.
 */

/** An error with the OAuth error code and status the app should see (RFC 6749 section 5.2, RFC 7591 section 3.2.2). */
export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE, ...headers } });
}

/** A public discovery document: no trip data, so any site may read it. */
export function publicDocument(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export function publicDocumentPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

export const connectorOff = (): Response => oauthJson({ error: "not_found", error_description: "The AI connector is turned off." }, 404);

/** Runs a machine route: 404 when the connector is off, OAuth errors in their own body, anything else sanitized. */
export async function handleOAuth(fn: () => Promise<Response>): Promise<Response> {
  if (!connectorEnabled()) return connectorOff();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OAuthError) return oauthJson({ error: err.error, error_description: err.message }, err.status);
    const requestId = randomUUID();
    console.error(`[${requestId}] ${errorTag(err)}`);
    return oauthJson({ error: "server_error", error_description: `Something went wrong. (Reference ${requestId})` }, 500);
  }
}

/** Reads a request body as text, refusing more than `maxBytes` of actual bytes. */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string> {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new OAuthError(413, "invalid_request", "That request is too large.");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The token and revocation endpoints take a form body (RFC 6749); a flat JSON object is accepted too. */
export async function readFormBody(req: Request, maxBytes = 16 * 1024): Promise<URLSearchParams> {
  const text = await readLimitedText(req, maxBytes);
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new OAuthError(400, "invalid_request", "The request body could not be read.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthError(400, "invalid_request", "The request body could not be read.");
    const form = new URLSearchParams();
    for (const [key, v] of Object.entries(value)) if (typeof v === "string") form.set(key, v);
    return form;
  }
  return new URLSearchParams(text);
}

/** For the connector's session routes (`route()`): the same 404 as the machine routes when it is turned off. */
export function requireConnector(): void {
  if (!connectorEnabled()) throw new HttpError(404, "not_found", "The AI connector is turned off.");
}
