import "server-only";
import type { Kysely, Transaction } from "kysely";
import type { DB, TripRow } from "./db-schema";
import type { Actor } from "./actor";
import { forbidden, isUuid, notFound } from "./http";
import type { Role } from "@/shared/dto";

type Conn = Kysely<DB> | Transaction<DB>;
export type TripAccess = { trip: TripRow & { owner_name: string | null }; role: Role };

/**
 * The per-trip authorization boundary (technical design section 9). An owner must
 * still be on the allowlist; a viewer needs an accepted grant bound to this user.
 * Pass lock=true inside a transaction to lock the trip row.
 */
export async function tripAccess(db: Conn, actor: Actor, tripId: string, lock = false): Promise<TripAccess | null> {
  if (!isUuid(tripId)) return null;
  let q = db
    .selectFrom("trips")
    .innerJoin("User", "User.id", "trips.owner_user_id")
    .selectAll("trips")
    .select("User.name as owner_name")
    .where("trips.id", "=", tripId);
  if (lock) q = q.forUpdate("trips");
  const trip = await q.executeTakeFirst();
  if (!trip) return null;
  if (trip.owner_user_id === actor.userId && actor.isOwner) return { trip, role: "owner" };
  const grant = await db
    .selectFrom("trip_viewers")
    .select("id")
    .where("trip_id", "=", tripId)
    .where("viewer_user_id", "=", actor.userId)
    .where("status", "=", "accepted")
    .executeTakeFirst();
  return grant ? { trip, role: "viewer" } : null;
}

export async function requireTripRead(db: Conn, actor: Actor, tripId: string): Promise<TripAccess> {
  const access = await tripAccess(db, actor, tripId);
  if (!access) throw notFound();
  return access;
}

/** Owner-only mutation guard: unknown/unreadable trips are 404, viewers get 403. */
export async function requireTripOwner(db: Conn, actor: Actor, tripId: string, lock = false): Promise<TripAccess> {
  const access = await tripAccess(db, actor, tripId, lock);
  if (!access) throw notFound();
  if (access.role !== "owner") throw forbidden();
  return access;
}

export function requireOwnerAccount(actor: Actor): void {
  if (!actor.isOwner) throw forbidden();
}
