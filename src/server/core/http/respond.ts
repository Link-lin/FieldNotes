import "server-only";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...NO_STORE } });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

function errorResponse(err: HttpError): Response {
  return json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } }, err.status);
}

/**
 * A log tag for an unexpected error: its class, plus a database error's SQLSTATE code and
 * constraint name ("error 23514 plan_items_title_check"). Never the message, which can quote
 * submitted values.
 */
export function errorTag(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error";
  const extra = err as Error & { code?: unknown; constraint?: unknown };
  const code = typeof extra.code === "string" && /^[0-9A-Z]{5}$/.test(extra.code) ? extra.code : null;
  const constraint = typeof extra.constraint === "string" && /^[a-z0-9_]{1,63}$/.test(extra.constraint) ? extra.constraint : null;
  return [err.name, code, constraint].filter(Boolean).join(" ");
}

/** Wraps a Route Handler: maps HttpError to the stable error body and hides unexpected errors. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    const requestId = randomUUID();
    // Provider/database errors can include submitted values in their messages.
    // Keep diagnostic context without logging trip content or a pasted AI response.
    console.error(`[${requestId}] ${errorTag(err)}`);
    return json({ error: { code: "server_error", message: `Something went wrong. Try again. (Reference ${requestId})` } }, 500);
  }
}
