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

/** Wraps a Route Handler: maps HttpError to the stable error body and hides unexpected errors. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    const requestId = randomUUID();
    // Log only the error type and message, never request bodies or trip content.
    console.error(`[${requestId}] ${err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error"}`);
    return json({ error: { code: "server_error", message: `Something went wrong. Try again. (Reference ${requestId})` } }, 500);
  }
}
