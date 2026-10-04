import "server-only";
import type { Kysely, Selectable, Transaction } from "kysely";
import type { DB, TripViewersTable } from "@/server/core/db/schema";
import type { Role } from "@/shared/dto";
import { emailKey } from "@/shared/email";

type Conn = Kysely<DB> | Transaction<DB>;
export type InvitationRow = Selectable<TripViewersTable>;

export async function tripInvitations(db: Conn, tripId: string): Promise<InvitationRow[]> {
  return db.selectFrom("trip_viewers").selectAll().where("trip_id", "=", tripId).orderBy("created_at").orderBy("id").execute();
}

/**
 * The trip's entry for this person, however the address is spelled: Gmail dots, "+tags" and
 * googlemail.com count as the same address, so one person never gets two entries. An accepted entry
 * wins if (from before this rule) there are several.
 */
export async function invitationForEmail(tx: Transaction<DB>, tripId: string, email: string): Promise<InvitationRow | undefined> {
  const key = emailKey(email);
  const rows = (await tx.selectFrom("trip_viewers").selectAll().where("trip_id", "=", tripId).orderBy("created_at").orderBy("id").forUpdate().execute()).filter((r) => emailKey(r.invitee_email_normalized) === key);
  return rows.find((r) => r.status === "accepted") ?? rows[0];
}

export async function insertInvitation(tx: Transaction<DB>, tripId: string, email: string, role: Role, hash: Buffer, expiresAt: Date): Promise<InvitationRow> {
  return tx
    .insertInto("trip_viewers")
    .values({ trip_id: tripId, invitee_email_normalized: email, role, status: "pending", invitation_token_hash: hash, expires_at: expiresAt })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Reissue: a new token, expiry and the chosen role in the same row. Any previous link and binding stop working. */
export async function reissueInvitation(tx: Transaction<DB>, id: string, role: Role, hash: Buffer, expiresAt: Date, now: Date): Promise<InvitationRow> {
  return tx
    .updateTable("trip_viewers")
    .set({ role, status: "pending", invitation_token_hash: hash, expires_at: expiresAt, viewer_user_id: null, accepted_at: null, revoked_at: null, updated_at: now })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Locks one entry of the trip; undefined when it does not exist. */
export async function invitationForUpdate(tx: Transaction<DB>, tripId: string, id: string): Promise<InvitationRow | undefined> {
  return tx.selectFrom("trip_viewers").selectAll().where("id", "=", id).where("trip_id", "=", tripId).forUpdate().executeTakeFirst();
}

/** Sets an entry's role. The change applies to the person's next request. */
export async function setInvitationRole(tx: Transaction<DB>, id: string, role: Role, now: Date): Promise<InvitationRow> {
  return tx.updateTable("trip_viewers").set({ role, updated_at: now }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
}

/** Revoke a pending or accepted entry. Returns false when no such entry exists on the trip. */
export async function revokeInvitationRow(tx: Transaction<DB>, tripId: string, id: string, now: Date): Promise<boolean> {
  const row = await tx.selectFrom("trip_viewers").select(["id", "status"]).where("id", "=", id).where("trip_id", "=", tripId).forUpdate().executeTakeFirst();
  if (!row) return false;
  if (row.status !== "revoked") {
    await tx.updateTable("trip_viewers").set({ status: "revoked", invitation_token_hash: null, revoked_at: now, updated_at: now }).where("id", "=", id).execute();
  }
  return true;
}

export async function invitationByHash(db: Conn, hash: Buffer, lock = false): Promise<InvitationRow | undefined> {
  let q = db.selectFrom("trip_viewers").selectAll().where("invitation_token_hash", "=", hash);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function markAccepted(tx: Transaction<DB>, id: string, userId: string, now: Date): Promise<void> {
  await tx
    .updateTable("trip_viewers")
    .set({ status: "accepted", viewer_user_id: userId, accepted_at: now, updated_at: now })
    .where("id", "=", id)
    .where("status", "=", "pending")
    .execute();
}
