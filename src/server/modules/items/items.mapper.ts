import "server-only";
import type { PlanItemRow } from "@/server/core/db/schema";
import type { PlanItemDTO } from "@/shared/dto";
import { providerLabel } from "@/shared/map-links";
import { trimAmount } from "@/shared/money";
import { dueState, resolveLocal } from "@/shared/time";
import { airportPoint } from "@/server/modules/places/airports";

const ts = (v: string | null) => (v ? v.replace(" ", "T").slice(0, 16) : null);
const hm = (v: string | null) => (v ? v.slice(0, 5) : null);
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * Plan item row to the API shape: timeline date and sort instant from the schedule, coordinates
 * from the map link (or a flight's arrival airport for a flight a person entered, reviewed or
 * booked), due state.
 */
export function itemDto(row: PlanItemRow, tripZone: string, today: string): PlanItemDTO {
  const isFlight = row.type === "flight";
  let timelineDate: string | null = null;
  let sortInstant: string | null = null;
  if (isFlight) {
    const dep = ts(row.departure_local_datetime);
    timelineDate = dep ? dep.slice(0, 10) : row.planned_departure_date;
    if (dep && row.departure_time_zone) {
      const r = resolveLocal(dep.slice(0, 10), dep.slice(11, 16), row.departure_time_zone, row.departure_disambiguation);
      if (r.ok) sortInstant = new Date(r.epochMs).toISOString();
    }
  } else {
    timelineDate = row.local_date;
    const t = hm(row.local_time);
    if (row.local_date && t) {
      const r = resolveLocal(row.local_date, t, row.time_zone ?? tripZone, row.time_disambiguation);
      if (r.ok) sortInstant = new Date(r.epochMs).toISOString();
    }
  }
  let coordinates: PlanItemDTO["coordinates"] = null;
  if (row.latitude !== null && row.longitude !== null) {
    coordinates = { latitude: Number(row.latitude), longitude: Number(row.longitude), source: row.pin_source === "lookup" ? "lookup" : "map_link" };
  } else if (isFlight && (row.source === "manual" || row.reviewed_at !== null || row.booking_status === "booked")) {
    const p = airportPoint(row.arrival_airport_code);
    if (p) coordinates = { ...p, source: "airport" };
  }
  return {
    id: row.id,
    version: row.version,
    type: row.type,
    title: row.title,
    source: row.source,
    reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null,
    location: row.location,
    notes: row.notes,
    links: row.links ?? [],
    mapUrl: row.map_url,
    mapProvider: row.map_url ? providerLabel(row.map_url) : null,
    coordinates,
    bookingStatus: row.booking_status,
    bookingDueDate: row.booking_due_date,
    bookingDueState: row.booking_status === "needs_booking" && row.booking_due_date ? dueState(row.booking_due_date, today) : null,
    plannedPrice:
      row.planned_amount !== null && row.planned_currency && row.price_label && row.price_source
        ? { amount: trimAmount(row.planned_amount), currency: row.planned_currency, label: row.price_label, source: row.price_source }
        : null,
    localDate: row.local_date,
    localTime: hm(row.local_time),
    timeZone: row.time_zone,
    timeDisambiguation: row.time_disambiguation,
    durationMinutes: row.duration_minutes,
    timelineDate,
    sortInstant,
    flightDetails: isFlight
      ? {
          plannedDepartureDate: row.planned_departure_date,
          airline: row.airline,
          flightNumber: row.flight_number,
          departure: {
            airportCode: row.departure_airport_code,
            localDateTime: ts(row.departure_local_datetime),
            timeZone: row.departure_time_zone,
            timeDisambiguation: row.departure_disambiguation,
          },
          arrival: {
            airportCode: row.arrival_airport_code,
            localDateTime: ts(row.arrival_local_datetime),
            timeZone: row.arrival_time_zone,
            timeDisambiguation: row.arrival_disambiguation,
          },
        }
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Timeline order (PLAN-1): by date, timed items by instant, then untimed; creation order breaks ties. */

/** Timeline order: date, then instant, then creation order (PLAN-1). */
export function compareItems(a: PlanItemDTO, b: PlanItemDTO): number {
  const da = a.timelineDate ?? "9999-99-99";
  const dbb = b.timelineDate ?? "9999-99-99";
  if (da !== dbb) return da < dbb ? -1 : 1;
  if (a.sortInstant && b.sortInstant && a.sortInstant !== b.sortInstant) return a.sortInstant < b.sortInstant ? -1 : 1;
  if (a.sortInstant && !b.sortInstant) return -1;
  if (!a.sortInstant && b.sortInstant) return 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
