import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { normalizeEmail, ownerEmails } from "@/server/core/env";
import { invitationByHash } from "@/server/modules/invitations/invitations.repository";
import { verifiedEmail } from "@/server/auth/identity";
import { emailKey, GMAIL_DOMAINS } from "@/shared/email";

export type SignInAttempt = {
  provider: string | undefined;
  providerAccountId: string | undefined;
  email: unknown;
  emailVerified: unknown;
  /** Apple only: the address is a relay address, because the person chose to hide their own. */
  emailPrivate?: unknown;
  /** The hash in the staging cookie, when the visitor arrived from an invitation link. */
  stagedHash?: Buffer | null;
  /** The account the visitor is already signed in as, when this is a sign-in method being connected to it. */
  signedInUserId?: string | null;
};

/** Whether the staged invitation is one by link that can still be used: pending, unexpired and without an address. */
async function linkInvitationOpen(db: Kysely<DB>, hash: Buffer, now: Date): Promise<boolean> {
  const row = await invitationByHash(db, hash);
  return Boolean(row && row.status === "pending" && row.label !== null && row.expires_at && row.expires_at > now);
}

/** The value of one cookie in a Cookie header; null if absent. */
export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Auth.js's session cookie: `__Secure-` on HTTPS, a plain name on http://localhost during development. */
export const sessionCookieName = (origin: string): string => (origin.startsWith("https:") ? "__Secure-authjs.session-token" : "authjs.session-token");

/** The account this request is already signed in as, from its session cookie; null when signed out or expired. */
export async function signedInUserId(db: Kysely<DB>, origin: string, cookieHeader: string | null, now = new Date()): Promise<string | null> {
  const token = cookieValue(cookieHeader, sessionCookieName(origin));
  if (!token) return null;
  const row = await db.selectFrom("Session").select("userId").where("sessionToken", "=", token).where("expires", ">", now).executeTakeFirst();
  return row?.userId ?? null;
}

/**
 * ACCESS-1: an already-linked Google, Apple or WeChat subject may always sign in (account management only; trip
 * access is checked per request). Someone already signed in may connect another method to their own account:
 * Auth.js links it, or refuses if it belongs to someone else. Otherwise a new account is admitted only by an
 * invitation.
 *
 * - With a verified email (Google's, or Apple's when the person shares it; see `verifiedEmail`) it needs that email
 *   on the owner allowlist or on a pending, unexpired invitation, or an unused invitation by link.
 * - With none (WeChat has none; an Apple person may hide theirs) it needs an unused invitation by link. Google
 *   without a verified email is refused even then: an unverified address must never become the account's email.
 *
 * Email alone never links accounts. Gmail addresses match by `emailKey`, so an invitation typed with other dots or a
 * "+tag" still admits them.
 */
export async function allowSignIn(db: Kysely<DB>, a: SignInAttempt, now = new Date()): Promise<boolean> {
  if ((a.provider !== "google" && a.provider !== "apple" && a.provider !== "wechat") || !a.providerAccountId) return false;
  const linked = await db
    .selectFrom("Account")
    .select("userId")
    .where("provider", "=", a.provider)
    .where("providerAccountId", "=", a.providerAccountId)
    .executeTakeFirst();
  if (linked || a.signedInUserId) return true;
  const email = verifiedEmail(a.provider, { email: a.email, email_verified: a.emailVerified, is_private_email: a.emailPrivate });
  const link = Boolean(a.stagedHash && (await linkInvitationOpen(db, a.stagedHash, now)));
  if (email === null) return a.provider !== "google" && link;
  if (link) return true;
  const key = emailKey(email);
  if (ownerEmails().has(key)) return true;
  // An exact match, or a Gmail-domain invitation (a different spelling of the same address) to compare by key.
  const typed = normalizeEmail(email);
  const invites = await db
    .selectFrom("trip_viewers")
    .select("invitee_email_normalized")
    .where("status", "=", "pending")
    .where("expires_at", ">", now)
    .where((eb) => eb.or([eb("invitee_email_normalized", "=", typed), eb(sql<string>`split_part(invitee_email_normalized, '@', 2)`, "in", [...GMAIL_DOMAINS])]))
    .execute();
  return invites.some((row) => row.invitee_email_normalized !== null && emailKey(row.invitee_email_normalized) === key);
}
