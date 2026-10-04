import "server-only";

/**
 * A fixed-window counter kept in memory for this server process (technical design: AI connector). It bounds a runaway
 * AI chat and a flood of app registrations; it is not abuse protection against a determined attacker, and a second
 * server process would count separately.
 */
type Window = { start: number; count: number };
const globalForLimits = globalThis as unknown as { __fnRateWindows?: Map<string, Window> };
const windows = (): Map<string, Window> => (globalForLimits.__fnRateWindows ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const all = windows();
  const w = all.get(key);
  if (!w || now - w.start >= windowMs) {
    if (all.size > 2000) for (const [k, v] of all) if (now - v.start >= windowMs) all.delete(k);
    all.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  if (w.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
  w.count += 1;
  return { ok: true };
}

/** Forgets every window; for tests. */
export function resetRateLimits(): void {
  windows().clear();
}
