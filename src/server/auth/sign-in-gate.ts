import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { normalizeEmail, ownerEmails } from "@/server/core/env";

export type SignInAttempt = {
  provider: string | undefined;
  providerAccountId: string | undefined;
  email: unknown;
  emailVerified: unknown;
};

/**
 * ACCESS-1: an already-linked Google subject may always sign in (account management only;
 * trip access is checked per request). A new account needs a verified email that is on the
 * owner allowlist or has a pending, unexpired invitation. Email alone never links accounts.
 */
export async function allowSignIn(db: Kysely<DB>, a: SignInAttempt, now = new Date()): Promise<boolean> {
  if (a.provider !== "google" || !a.providerAccountId) return false;
  const linked = await db
    .selectFrom("Account")
    .select("userId")
    .where("provider", "=", "google")
    .where("providerAccountId", "=", a.providerAccountId)
    .executeTakeFirst();
  if (linked) return true;
  if (a.emailVerified !== true || typeof a.email !== "string") return false;
  const email = normalizeEmail(a.email);
  if (ownerEmails().has(email)) return true;
  const invite = await db
    .selectFrom("trip_viewers")
    .select("id")
    .where("invitee_email_normalized", "=", email)
    .where("status", "=", "pending")
    .where("expires_at", ">", now)
    .executeTakeFirst();
  return Boolean(invite);
}
