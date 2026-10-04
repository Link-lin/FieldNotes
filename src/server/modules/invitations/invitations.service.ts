import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner } from "@/server/auth/access";
import { appOrigin } from "@/server/core/env";
import { mailConfigured, sendMail } from "@/server/core/mail";
import { HttpError, invalid } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import type { InvitationDelivery, InvitationDTO, InvitationLinkDTO, Role } from "@/shared/dto";
import { emailKey } from "@/shared/email";
import { invitationEmail } from "./invitations.email";
import { invitationDto } from "./invitations.mapper";
import {
  insertInvitation,
  invitationByHash,
  invitationForEmail,
  invitationForUpdate,
  markAccepted,
  reissueInvitation,
  revokeInvitationRow,
  setInvitationRole,
  tripInvitations,
} from "./invitations.repository";
import { hashInvitationToken, INVITATION_TTL_MS, invitationStatus, isInvitationToken, newInvitationToken } from "./invitations.rules";

/** One answer for every unusable link, so a link reveals nothing about a trip, its owner or the invited email. */
export const invalidInvitation = () =>
  new HttpError(404, "invitation_invalid", "This invitation link isn't valid any more. Ask the person who shared the trip for a new link.");

/**
 * With email on, a new link for a pending person within this long of the last one is refused, so an
 * owner's second click can't replace the link in the email that has just been sent.
 */
export const EMAIL_COOLDOWN_MS = 60_000;

const invitationNotFound = () => new HttpError(404, "not_found", "That invitation doesn't exist.");

/** ACCESS-11: the owners' list of the people a trip is shared with and their invitations, oldest first. */
export async function listInvitations(db: Kysely<DB>, actor: Actor, tripId: string, now = new Date()): Promise<InvitationDTO[]> {
  await requireTripOwner(db, actor, tripId);
  return (await tripInvitations(db, tripId)).map((r) => invitationDto(r, now));
}

/**
 * ACCESS-3/6: create an invitation for one email with a role (viewer unless the owner chose otherwise), or
 * give a pending, expired or revoked one a new link and the chosen role. The raw token is returned once and
 * only its hash is stored; a new link invalidates the previous one. Someone who has already accepted keeps
 * their entry: change their role, or revoke them, instead. When email is configured the invitation is also
 * emailed, after the change is committed; if that fails the invitation still exists and the link is
 * returned to copy (`delivery: "failed"`).
 */
export async function createInvitation(db: Kysely<DB>, actor: Actor, tripId: string, email: string, now = new Date(), role: Role = "viewer"): Promise<InvitationLinkDTO> {
  const created = await db.transaction().execute(async (tx) => {
    // Locking the trip serializes concurrent invitations for the same new email.
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (emailKey(email) === emailKey(actor.email)) {
      throw invalid([{ path: "email", code: "own_email", message: "That's your own email. You already own this trip." }], "You can't invite yourself.");
    }
    const token = newInvitationToken();
    const hash = hashInvitationToken(token);
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const existing = await invitationForEmail(tx, tripId, email);
    if (existing?.status === "accepted") {
      throw new HttpError(409, "invitation_accepted", "This person already has access. Change their role in the list below, or revoke their access first to send a new link.");
    }
    const sinceLast = existing ? now.getTime() - existing.updated_at.getTime() : null;
    if (mailConfigured() && existing?.status === "pending" && sinceLast !== null && sinceLast >= 0 && sinceLast < EMAIL_COOLDOWN_MS) {
      throw new HttpError(429, "invitation_recent", "A link was just sent to this person. Wait a minute before sending another, so the link in their email keeps working. To change what they can do, use their role in the list.");
    }
    const row = existing ? await reissueInvitation(tx, existing.id, role, hash, expiresAt, now) : await insertInvitation(tx, tripId, email, role, hash, expiresAt);
    return { row, url: `${appOrigin()}/invite#${token}`, expiresAt, tripTitle: trip.title };
  });
  const delivery = await emailInvitation(db, actor, created.row.invitee_email_normalized, created.row.role, created.tripTitle, created.url, created.expiresAt);
  return {
    invitationId: created.row.id,
    invitationUrl: created.url,
    expiresAt: created.expiresAt.toISOString(),
    invitation: invitationDto(created.row, now),
    delivery,
  };
}

/** Sends the invitation email, if email is set up. Never throws: a failure is reported, not raised. */
async function emailInvitation(db: Kysely<DB>, actor: Actor, to: string, role: Role, tripTitle: string, url: string, expiresAt: Date): Promise<InvitationDelivery> {
  if (!mailConfigured()) return "off";
  try {
    const sender = await db.selectFrom("User").select("name").where("id", "=", actor.userId).executeTakeFirst();
    const mail = invitationEmail({ tripTitle, inviterName: sender?.name?.trim() || actor.email, inviteeEmail: to, role, url, expiresAt });
    await sendMail({ to, replyTo: actor.email, ...mail });
    return "sent";
  } catch (err) {
    // The error's name and code only: a mail error's message can contain the address or the server's reply.
    const code = typeof (err as { code?: unknown })?.code === "string" ? ` ${(err as { code: string }).code}` : "";
    console.error(`[mail] ${err instanceof Error ? err.name : "Unknown error"}${code}`);
    return "failed";
  }
}

/**
 * ACCESS-5: an owner changes what a pending or accepted person may do (also their own role, to step down).
 * It takes effect on their next request. A revoked entry needs a new link first.
 */
export async function updateInvitationRole(db: Kysely<DB>, actor: Actor, tripId: string, invitationId: string, role: Role, now = new Date()): Promise<InvitationDTO> {
  return db.transaction().execute(async (tx) => {
    await requireTripOwner(tx, actor, tripId, true);
    const row = isUuid(invitationId) ? await invitationForUpdate(tx, tripId, invitationId) : undefined;
    if (!row) throw invitationNotFound();
    if (row.status === "revoked") throw new HttpError(409, "invitation_revoked", "This person's access was revoked. Create a new link to invite them again.");
    return invitationDto(await setInvitationRole(tx, row.id, role), now);
  });
}

/** ACCESS-6: revoke a pending or accepted entry. The viewer's next request is refused. */
export async function revokeInvitation(db: Kysely<DB>, actor: Actor, tripId: string, invitationId: string, now = new Date()): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await requireTripOwner(tx, actor, tripId, true);
    if (!isUuid(invitationId) || !(await revokeInvitationRow(tx, tripId, invitationId, now))) throw invitationNotFound();
  });
}

/**
 * Staging (no session needed): check the link's token and return its hash for the staging cookie.
 * A pending, unexpired link can be staged; so can an accepted one, so the account it was bound to can
 * open it again. Nothing about the trip is returned.
 */
export async function stageInvitation(db: Kysely<DB>, token: string, now = new Date()): Promise<Buffer> {
  if (!isInvitationToken(token)) throw invalidInvitation();
  const hash = hashInvitationToken(token);
  const row = await invitationByHash(db, hash);
  if (!row || invitationStatus(row, now) === "expired") throw invalidInvitation();
  return hash;
}

/**
 * ACCESS-4: bind a staged invitation to the signed-in account when its email matches the invitation.
 * The account's email is the verified Google email the sign-in gate admitted when the account was
 * created. A retry by the bound account returns the same trip; any other account gets the generic answer.
 */
export async function acceptInvitation(db: Kysely<DB>, actor: Actor, hash: Buffer | null, now = new Date()): Promise<{ tripId: string }> {
  if (!hash) throw invalidInvitation();
  return db.transaction().execute(async (tx) => {
    const row = await invitationByHash(tx, hash, true);
    if (!row) throw invalidInvitation();
    if (row.status === "accepted") {
      if (row.viewer_user_id === actor.userId) return { tripId: row.trip_id };
      throw invalidInvitation();
    }
    if (invitationStatus(row, now) !== "pending") throw invalidInvitation();
    if (emailKey(row.invitee_email_normalized) !== emailKey(actor.email)) {
      throw new HttpError(403, "invitation_wrong_account", "This invitation is for a different Google account. Switch to the account it was sent to.");
    }
    await markAccepted(tx, row.id, actor.userId, now);
    return { tripId: row.trip_id };
  });
}
