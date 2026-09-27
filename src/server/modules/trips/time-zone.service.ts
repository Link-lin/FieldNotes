import "server-only";
import type { Kysely } from "kysely";
import type { Conn, Tx } from "@/server/core/db/client";
import type { DB, TripRow } from "@/server/core/db/schema";
import { conflict, HttpError, invalid } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner } from "@/server/auth/access";
import { inheritedTimedItems, openBookingItems, setTimeDisambiguation } from "@/server/modules/items/items.repository";
import type { FieldError } from "@/shared/dto";
import { dateInZone, dueState, resolveLocal } from "@/shared/time";

/*
 * Trip time-zone changes (TRIP-4). Items without their own zone keep their local times, read in
 * the new zone: times that don't exist block the change, repeated times need a choice.
 */

export type ZoneImpact = { itemId: string; title: string; localDate: string; localTime: string; result: "ok" | "gap" | "ambiguous" };

async function zoneImpact(db: Conn, tripId: string, zone: string): Promise<ZoneImpact[]> {
  const rows = await inheritedTimedItems(db, tripId);
  return rows.map((r) => {
    const t = r.local_time!.slice(0, 5);
    const res = resolveLocal(r.local_date!, t, zone, null);
    return { itemId: r.id, title: r.title, localDate: r.local_date!, localTime: t, result: res.ok ? "ok" : res.reason };
  });
}

/** Read-only preview: every affected event and every booking task's due state before and after. */
export async function previewTimeZone(db: Kysely<DB>, actor: Actor, tripId: string, zone: string, expectedVersion: number, now = new Date()) {
  const { trip } = await requireTripOwner(db, actor, tripId);
  if (trip.version !== expectedVersion) throw conflict();
  const items = await zoneImpact(db, trip.id, zone);
  const due = await openBookingItems(db, [trip.id], true);
  const before = dateInZone(trip.time_zone, now.getTime());
  const after = dateInZone(zone, now.getTime());
  const bookingTasks = due.map((r) => ({
    itemId: r.id,
    title: r.title,
    dueDate: r.booking_due_date!,
    before: dueState(r.booking_due_date!, before),
    after: dueState(r.booking_due_date!, after),
  }));
  return { items, bookingTasksAffected: bookingTasks.length, bookingTasks };
}

/** Inside the trip update: requires confirmation and choices, then records each item's choice. */
export async function applyTimeZoneChange(
  tx: Tx,
  trip: TripRow,
  zone: string,
  confirmed: boolean | undefined,
  choices: Record<string, "earlier" | "later">,
): Promise<void> {
  if (!confirmed) throw new HttpError(409, "time_zone_confirmation_required", "Confirm the time-zone change after reviewing its effect.");
  const impact = await zoneImpact(tx, trip.id, zone);
  const errors: FieldError[] = [];
  for (const i of impact) {
    if (i.result === "gap") errors.push({ path: `items.${i.itemId}.localTime`, code: "nonexistent_local_time", message: `${i.title}: ${i.localTime} doesn't exist on ${i.localDate} in ${zone}. Change the time or give the event its own time zone first.` });
    if (i.result === "ambiguous" && !choices[i.itemId]) errors.push({ path: `items.${i.itemId}.timeDisambiguation`, code: "ambiguous_local_time", message: `${i.title}: ${i.localTime} happens twice on ${i.localDate}. Choose the earlier or later one.` });
  }
  if (errors.length) throw invalid(errors, "Some event times need attention before changing the time zone.");
  for (const i of impact) await setTimeDisambiguation(tx, i.itemId, i.result === "ambiguous" ? choices[i.itemId]! : null);
}
