import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner } from "@/server/auth/access";
import { appOrigin } from "@/server/core/env";
import { HttpError, invalid } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import type { InvitationDTO, InvitationLinkDTO } from "@/shared/dto";
import { invitationDto } from "./invitations.mapper";
import {
  insertInvitation,
  invitationByHash,
  invitationForEmail,
  markAccepted,
  reissueInvitation,
  revokeInvitationRow,
  tripInvitations,
} from "./invitations.repository";
import { hashInvitationToken, INVITATION_TTL_MS, invitationStatus, isInvitationToken, newInvitationToken } from "./invitations.rules";

/** One answer for every unusable link, so a link reveals nothing about a trip, its owner or the invited email. */
export const invalidInvitation = () =>
  new HttpError(404, "invitation_invalid", "This invitation link isn't valid any more. Ask the person who shared the trip for a new link.");

const invitationNotFound = () => new HttpError(404, "not_found", "That invitation doesn't exist.");

/** ACCESS-11: the owner's list of viewers and invitations, oldest first. */
export async function listInvitations(db: Kysely<DB>, actor: Actor, tripId: string, now = new Date()): Promise<InvitationDTO[]> {
  await requireTripOwner(db, actor, tripId);
  return (await tripInvitations(db, tripId)).map((r) => invitationDto(r, now));
}

/**
 * ACCESS-3/6: create an invitation for one email, or give a pending, expired or revoked one a new
 * link. The raw token is returned once and only its hash is stored; a new link invalidates the
 * previous one. An accepted viewer must be revoked first. No email is sent.
 */
export async function createInvitation(db: Kysely<DB>, actor: Actor, tripId: string, email: string, now = new Date()): Promise<InvitationLinkDTO> {
  return db.transaction().execute(async (tx) => {
    // Locking the trip serializes concurrent invitations for the same new email.
    await requireTripOwner(tx, actor, tripId, true);
    if (email === actor.email) {
      throw invalid([{ path: "email", code: "own_email", message: "That's your own email. You already own this trip." }], "You can't invite yourself.");
    }
    const token = newInvitationToken();
    const hash = hashInvitationToken(token);
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const existing = await invitationForEmail(tx, tripId, email);
    if (existing?.status === "accepted") {
      throw new HttpError(409, "invitation_accepted", "This person can already see the trip. Revoke their access first if you want to send a new link.");
    }
    const row = existing ? await reissueInvitation(tx, existing.id, hash, expiresAt, now) : await insertInvitation(tx, tripId, email, hash, expiresAt);
    return {
      invitationId: row.id,
      invitationUrl: `${appOrigin()}/invite#${token}`,
      expiresAt: expiresAt.toISOString(),
      invitation: invitationDto(row, now),
    };
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
    if (row.invitee_email_normalized !== actor.email) {
      throw new HttpError(403, "invitation_wrong_account", "This invitation is for a different Google account. Switch to the account it was sent to.");
    }
    await markAccepted(tx, row.id, actor.userId, now);
    return { tripId: row.trip_id };
  });
}
