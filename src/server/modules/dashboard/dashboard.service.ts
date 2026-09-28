import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { openBookingItems } from "@/server/modules/items/items.repository";
import { canMarkBooked } from "@/server/modules/items/items.rules";
import { recentCurrencies } from "@/server/modules/trips/budget.repository";
import { tripSummary } from "@/server/modules/trips/trips.mapper";
import { visibleTrips } from "@/server/modules/trips/trips.repository";
import type { BookingTaskDTO, DashboardDTO } from "@/shared/dto";
import { dateInZone, dueState } from "@/shared/time";

const byDue = (a: BookingTaskDTO, b: BookingTaskDTO) => {
  const x = a.dueDate ?? "9999";
  const y = b.dueDate ?? "9999";
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * DASH-1: every trip the person may see, and for owners their booking tasks across trips
 * (BOOK-3, due state in each trip's own zone) and their recent currencies.
 */
export async function getDashboard(db: Kysely<DB>, actor: Actor, now = new Date()): Promise<DashboardDTO> {
  const rows = await visibleTrips(db, actor);
  const isMine = (r: (typeof rows)[number]) => r.owner_user_id === actor.userId && actor.isOwner;
  const trips = rows.map((r) => tripSummary(r, isMine(r) ? "owner" : "viewer", now));
  const owned = new Map(rows.filter(isMine).map((r) => [r.id, r]));
  const ownerBookingTasks: BookingTaskDTO[] = (await openBookingItems(db, [...owned.keys()]))
    .map((i) => {
      const trip = owned.get(i.trip_id)!;
      const today = dateInZone(trip.time_zone, now.getTime());
      return {
        tripId: trip.id,
        tripTitle: trip.title,
        itemId: i.id,
        itemTitle: i.title,
        itemVersion: i.version,
        dueDate: i.booking_due_date,
        state: i.booking_due_date ? dueState(i.booking_due_date, today) : ("no_due_date" as const),
        canMarkBooked: canMarkBooked(i),
      };
    })
    .sort(byDue);
  return { canCreateTrips: actor.isOwner, trips, ownerBookingTasks, recentCurrencies: actor.isOwner ? await recentCurrencies(db, actor.userId) : [] };
}
