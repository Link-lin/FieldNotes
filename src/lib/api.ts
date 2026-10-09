import type { ApiError, FieldError } from "@/shared/dto";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; fields: FieldError[] };

// This tab's own saves, so a live update can tell them from changes made elsewhere (TRIP-11).
let writing = 0;
let lastWrite = 0;

/** When this tab last saved something through `api`: now while a save is in flight, 0 before the first. */
export function lastWriteAt(): number {
  return writing > 0 ? Date.now() : lastWrite;
}

/**
 * Same-origin call to a Route Handler with a JSON body, or a `FormData` one (the trip cover's upload). The browser sends
 * Origin; the server checks it.
 */
export async function api<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
): Promise<ApiResult<T>> {
  if (method === "GET") return call<T>(method, url, body, options);
  writing += 1;
  try {
    return await call<T>(method, url, body, options);
  } finally {
    writing -= 1;
    lastWrite = Date.now();
  }
}

async function call<T>(method: string, url: string, body: unknown, options?: { headers?: Record<string, string> }): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      // A form sets its own multipart type, with the boundary.
      headers: { ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: "Couldn't reach the server. Check your connection and try again.", fields: [] };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.ok) return { ok: true, data: payload as T };
  const err = (payload as ApiError | null)?.error;
  // A 401 means the session ended; the caller shows the message and the next navigation goes to sign-in.
  return { ok: false, status: res.status, code: err?.code ?? "error", message: err?.message ?? "Something went wrong. Try again.", fields: err?.fields ?? [] };
}
