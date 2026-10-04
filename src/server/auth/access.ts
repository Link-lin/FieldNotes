import "server-only";
import type { Kysely, Transaction } from "kysely";
import type { DB, TripRow } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { forbidden, notFound } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import type { Role } from "@/shared/dto";
import { canEdit, canManage } from "@/shared/roles";

type Conn = Kysely<DB> | Transaction<DB>;
/** `primaryOwner` is true for the person who created the trip; other owners were given the role. */
export type TripAccess = { trip: TripRow & { owner_name: string | null }; role: Role; primaryOwner: boolean };

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * The per-trip authorization boundary (technical design: Security and privacy). The creator is an owner
 * only while still on the allowlist (and not at all once their account is gone). Everyone else needs an
 * accepted grant bound to this user, whose role (viewer, editor or owner) decides what they may do; if there
 * are several, the highest wins.
 * Pass lock=true inside a transaction to lock the trip row.
 */
export async function tripAccess(db: Conn, actor: Actor, tripId: string, lock = false): Promise<TripAccess | null> {
  if (!isUuid(tripId)) return null;
  let q = db
    .selectFrom("trips")
    .leftJoin("User", "User.id", "trips.owner_user_id")
    .selectAll("trips")
    .select("User.name as owner_name")
    .where("trips.id", "=", tripId);
  if (lock) q = q.forUpdate("trips");
  const trip = await q.executeTakeFirst();
  if (!trip) return null;
  if (trip.owner_user_id === actor.userId && actor.isOwner) return { trip, role: "owner", primaryOwner: true };
  const grants = await db
    .selectFrom("trip_viewers")
    .select("role")
    .where("trip_id", "=", tripId)
    .where("viewer_user_id", "=", actor.userId)
    .where("status", "=", "accepted")
    .execute();
  if (!grants.length) return null;
  const role = grants.map((g) => g.role).reduce((best, r) => (RANK[r] > RANK[best] ? r : best));
  return { trip, role, primaryOwner: false };
}

export async function requireTripRead(db: Conn, actor: Actor, tripId: string): Promise<TripAccess> {
  const access = await tripAccess(db, actor, tripId);
  if (!access) throw notFound();
  return access;
}

/** Guard for changing events, bookings and notes: viewers get 403; unknown or unreadable trips are 404. */
export async function requireTripEditor(db: Conn, actor: Actor, tripId: string, lock = false): Promise<TripAccess> {
  const access = await tripAccess(db, actor, tripId, lock);
  if (!access) throw notFound();
  if (!canEdit(access.role)) throw forbidden();
  return access;
}

/** Guard for the trip itself and its sharing: editors and viewers get 403; unknown or unreadable trips are 404. */
export async function requireTripOwner(db: Conn, actor: Actor, tripId: string, lock = false): Promise<TripAccess> {
  const access = await tripAccess(db, actor, tripId, lock);
  if (!access) throw notFound();
  if (!canManage(access.role)) throw forbidden();
  return access;
}

/** Account-level guard: creating trips and importing need the allowlist. */
export function requireOwnerAccount(actor: Actor): void {
  if (!actor.isOwner) throw forbidden();
}

/**
 * Account-level guard for the helpers an editor needs (place search and place lookup): the allowlist,
 * or an accepted editor or owner grant on some trip. A viewer or stranger never reaches them.
 */
export async function requireEditorAccount(db: Conn, actor: Actor): Promise<void> {
  if (actor.isOwner) return;
  const grant = await db
    .selectFrom("trip_viewers")
    .select("id")
    .where("viewer_user_id", "=", actor.userId)
    .where("status", "=", "accepted")
    .where("role", "in", ["editor", "owner"])
    .executeTakeFirst();
  if (!grant) throw forbidden();
}
