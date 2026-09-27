import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { toFieldErrors } from "@/shared/schemas";
import type { FieldError } from "@/shared/dto";
import { appOrigin } from "./env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", "That trip or event doesn't exist, or you can't see it.");
export const forbidden = () => new HttpError(403, "forbidden", "Only the trip owner can do that.");
export const conflict = (message = "This changed in another tab or window. Reload to see the latest, then make your change again.") =>
  new HttpError(409, "version_conflict", message);
export const invalid = (fields: FieldError[], message = "Correct the highlighted fields.") => new HttpError(422, "validation_error", message, fields);

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

/** CSRF defense for every state-changing request: Origin must equal the canonical origin. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin || origin !== appOrigin()) throw new HttpError(403, "bad_origin", "This request did not come from the app.");
}

export const MAX_BODY_BYTES = 1024 * 1024;

/** Read and validate a JSON body, enforcing the 1 MiB limit on the actual bytes. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "too_large", "That request is too large.");
      }
      chunks.push(value);
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "The request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid(toFieldErrors(parsed.error));
  return parsed.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
