import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { invitationByHash } from "@/server/modules/invitations/invitations.repository";
import { normalizeEmail, ownerEmails } from "@/server/core/env";
import { emailKey, GMAIL_DOMAINS } from "@/shared/email";

export type SignInAttempt = {
  provider: string | undefined;
  providerAccountId: string | undefined;
  email: unknown;
  emailVerified: unknown;
  /** The hash in the staging cookie, when the visitor arrived from an invitation link. */
  stagedHash?: Buffer | null;
};

/** Whether the staged invitation is one by link that can still be used: pending, unexpired and without an address. */
async function linkInvitationOpen(db: Kysely<DB>, hash: Buffer, now: Date): Promise<boolean> {
  const row = await invitationByHash(db, hash);
  return Boolean(row && row.status === "pending" && row.label !== null && row.expires_at && row.expires_at > now);
}

/**
 * ACCESS-1: an already-linked Google subject may always sign in (account management only;
 * trip access is checked per request). A new account needs a verified email that is on the
 * owner allowlist or has a pending, unexpired invitation, or has arrived from an unused invitation by link
 * (which still needs a verified email: an unverified address must never become the account's email). Email
 * alone never links accounts. Gmail addresses match by `emailKey`, so an invitation typed with other dots or a
 * "+tag" still admits them.
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
  if (a.stagedHash && (await linkInvitationOpen(db, a.stagedHash, now))) return true;
  const key = emailKey(a.email);
  if (ownerEmails().has(key)) return true;
  // An exact match, or a Gmail-domain invitation (a different spelling of the same address) to compare by key.
  const typed = normalizeEmail(a.email);
  const invites = await db
    .selectFrom("trip_viewers")
    .select("invitee_email_normalized")
    .where("status", "=", "pending")
    .where("expires_at", ">", now)
    .where((eb) => eb.or([eb("invitee_email_normalized", "=", typed), eb(sql<string>`split_part(invitee_email_normalized, '@', 2)`, "in", [...GMAIL_DOMAINS])]))
    .execute();
  return invites.some((row) => row.invitee_email_normalized !== null && emailKey(row.invitee_email_normalized) === key);
}
