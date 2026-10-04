import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { normalizeEmail } from "@/server/core/env";

/**
 * Connecting a verified Google account to an account that has no email (it signed in with WeChat) gives it that
 * address, so the owner allowlist and email invitations can match it. It never replaces an address the account
 * already has, and an address another account holds is left alone. An unverified address is never adopted.
 */
export async function adoptVerifiedEmail(db: Kysely<DB>, userId: string, provider: string, profile: { email?: unknown; email_verified?: unknown }): Promise<void> {
  if (provider !== "google" || profile.email_verified !== true || typeof profile.email !== "string") return;
  try {
    await db.updateTable("User").set({ email: normalizeEmail(profile.email), emailVerified: new Date() }).where("id", "=", userId).where("email", "is", null).execute();
  } catch (err) {
    // The address belongs to another account: the methods stay connected, the account stays without an email.
    if (!(typeof err === "object" && err !== null && "code" in err && err.code === "23505")) throw err;
  }
}
