import "server-only";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { openBookingItems } from "@/server/modules/items/items.repository";
import { recentCurrencies } from "@/server/modules/trips/budget.repository";
import { tripSummary } from "@/server/modules/trips/trips.mapper";
import { visibleTrips } from "@/server/modules/trips/trips.repository";
import type { BookingTaskDTO, DashboardDTO, Role } from "@/shared/dto";
import { canEdit } from "@/shared/roles";
import { dateInZone, dueState } from "@/shared/time";

const byDue = (a: BookingTaskDTO, b: BookingTaskDTO) => {
  const x = a.dueDate ?? "9999";
  const y = b.dueDate ?? "9999";
  return x < y ? -1 : x > y ? 1 : 0;
};

type VisibleTrip = Awaited<ReturnType<typeof visibleTrips>>[number];

// Your own trips (the creator, while allowlisted) are owner trips; the rest take the role of your grant.
const accessOf = (actor: Actor, r: VisibleTrip): { role: Role; primaryOwner: boolean } =>
  r.owner_user_id === actor.userId && actor.isOwner ? { role: "owner", primaryOwner: true } : { role: r.member_role ?? "viewer", primaryOwner: false };

/** Live updates (TRIP-11): changes when a trip appears, goes, changes (its version moves with its events) or your role on one does. */
function revisionOf(actor: Actor, rows: VisibleTrip[]): string {
  const parts = rows.map((r) => `${r.id}.${r.version}.${accessOf(actor, r).role}`).sort();
  return createHash("sha256").update(parts.join(",")).digest("base64url").slice(0, 22);
}

/** The dashboard's revision, which the open dashboard asks for every few seconds. */
export async function getDashboardRevision(db: Kysely<DB>, actor: Actor): Promise<{ revision: string }> {
  return { revision: revisionOf(actor, await visibleTrips(db, actor)) };
}

/**
 * DASH-1: every trip the person may see with their role on it, and booking counts for the trips they can
 * edit (BOOK-3, due state in each trip's own zone), plus their recent currencies if they may create trips.
 */
export async function getDashboard(db: Kysely<DB>, actor: Actor, now = new Date()): Promise<DashboardDTO> {
  const rows = await visibleTrips(db, actor);
  const trips = rows.map((r) => tripSummary(r, accessOf(actor, r), now));
  const owned = new Map(rows.filter((r) => canEdit(accessOf(actor, r).role)).map((r) => [r.id, r]));
  const ownerBookingTasks: BookingTaskDTO[] = (await openBookingItems(db, [...owned.keys()]))
    .map((i) => {
      const trip = owned.get(i.trip_id)!;
      const today = dateInZone(trip.time_zone, now.getTime());
      return {
        tripId: trip.id,
        tripTitle: trip.title,
        itemId: i.id,
        itemTitle: i.title,
        dueDate: i.booking_due_date,
        state: i.booking_due_date ? dueState(i.booking_due_date, today) : ("no_due_date" as const),
      };
    })
    .sort(byDue);
  return { canCreateTrips: actor.isOwner, trips, ownerBookingTasks, recentCurrencies: actor.isOwner ? await recentCurrencies(db, actor.userId) : [], revision: revisionOf(actor, rows) };
}
