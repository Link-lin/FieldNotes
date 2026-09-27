import "server-only";

/** Normalized owner allowlist (TRIP_OWNER_EMAILS). Required in production. */
export function ownerEmails(): ReadonlySet<string> {
  const raw = process.env.TRIP_OWNER_EMAILS ?? "";
  const set = new Set(
    raw
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
  if (set.size === 0 && process.env.NODE_ENV === "production") {
    throw new Error("TRIP_OWNER_EMAILS must list at least one owner email in production.");
  }
  return set;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Canonical application origin used for the Origin check on every mutation. */
export function appOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (origin) return new URL(origin).origin;
  if (process.env.NODE_ENV === "production") throw new Error("APP_ORIGIN must be set in production.");
  return "http://localhost:3000";
}
