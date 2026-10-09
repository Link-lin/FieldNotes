import "server-only";
import type { z } from "zod";
import { toFieldErrors } from "@/shared/schemas";
import { appOrigin } from "@/server/core/env";
import { HttpError, invalid } from "./errors";

/** CSRF defense for every state-changing request: Origin must equal the canonical origin. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin || origin !== appOrigin()) throw new HttpError(403, "bad_origin", "This request did not come from the app.");
}

export const MAX_BODY_BYTES = 1024 * 1024;

/** Read and validate a JSON body, enforcing the 1 MiB limit on the actual bytes. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = JSON.parse((await readBytes(req)).toString("utf8"));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "bad_request", "The request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid(toFieldErrors(parsed.error));
  return parsed.data;
}

/** Read a `multipart/form-data` body (the trip cover's upload, DASH-8) under the same 1 MiB limit. */
export async function readForm(req: Request): Promise<FormData> {
  const type = req.headers.get("content-type") ?? "";
  const notForm = () => new HttpError(400, "bad_request", "The request body must be a form.");
  if (!/^multipart\/form-data;/i.test(type)) throw notForm();
  const bytes = await readBytes(req);
  try {
    return await new Response(new Uint8Array(bytes), { headers: { "content-type": type } }).formData();
  } catch {
    throw notForm();
  }
}

/** The body's bytes; 413 as soon as they pass 1 MiB, whatever `Content-Length` says. */
async function readBytes(req: Request): Promise<Buffer> {
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
  return Buffer.concat(chunks);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
