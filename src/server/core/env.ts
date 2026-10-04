import "server-only";
import { emailKey } from "@/shared/email";

/**
 * The owner allowlist (TRIP_OWNER_EMAILS) as address keys, so look an address up with `emailKey`:
 * a Gmail owner matches whatever the dots, "+tag" or googlemail.com spelling. Required in production.
 */
export function ownerEmails(): ReadonlySet<string> {
  const raw = process.env.TRIP_OWNER_EMAILS ?? "";
  const set = new Set(
    raw
      .split(",")
      .map((e) => (e.trim() ? emailKey(e) : ""))
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

/**
 * Browser key for the Google Maps Embed API, shown in the event side panel (MAP-8). Optional:
 * without it the panel shows the event without a map. Restrict the key to the Maps Embed API and
 * to this site's address in Google Cloud; the page sends only its origin as the referrer.
 */
export function mapsEmbedKey(): string | null {
  const key = process.env.GOOGLE_MAPS_EMBED_API_KEY?.trim();
  return key ? key : null;
}
