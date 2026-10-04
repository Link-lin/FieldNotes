import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { verifiedEmail, type EmailClaims } from "@/server/auth/identity";
import { normalizeEmail } from "@/server/core/env";

/**
 * Connecting a verified Google account, or an Apple account that shares its address, to an account that has no email
 * (it signed in with WeChat, or with Apple while hiding it) gives it that address, so the owner allowlist and email
 * invitations can match it. It never replaces an address the account already has, and an address another account
 * holds is left alone. An unverified or hidden address is never adopted.
 */
export async function adoptVerifiedEmail(db: Kysely<DB>, userId: string, provider: string, profile: EmailClaims): Promise<void> {
  const email = verifiedEmail(provider, profile);
  if (email === null) return;
  try {
    await db.updateTable("User").set({ email: normalizeEmail(email), emailVerified: new Date() }).where("id", "=", userId).where("email", "is", null).execute();
  } catch (err) {
    // The address belongs to another account: the methods stay connected, the account stays without an email.
    if (!(typeof err === "object" && err !== null && "code" in err && err.code === "23505")) throw err;
  }
}
