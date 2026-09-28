import type { ApiError, FieldError } from "@/shared/dto";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; fields: FieldError[] };

/** Same-origin JSON call to a Route Handler. The browser sends Origin; the server checks it. */
export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
