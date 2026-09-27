import "server-only";
import type { Insertable } from "kysely";
import type { PlanItemRow, PlanItemsTable } from "@/server/core/db/schema";
import type { FieldError } from "@/shared/dto";
import { cleanMapUrl, coordinatesFromMapUrl } from "@/shared/map-links";
import { trimAmount } from "@/shared/money";
import type { ItemInput } from "@/shared/schemas";
import { resolveLocal } from "@/shared/time";

/*
 * Pure rules for plan items: schedule checks that need time-zone data, when a map link is
 * re-read (MAP-2), when an AI price stays unverified (BUDGET-4), and input to column values.
 */

export type Values = Omit<Insertable<PlanItemsTable>, "trip_id" | "source">;

/** Domain checks that need time-zone data: gaps, repeated times, arrival after departure. */
export function scheduleErrors(input: ItemInput, tripZone: string): FieldError[] {
  const errors: FieldError[] = [];
  const check = (date: string, time: string, zone: string, choice: "earlier" | "later" | null, path: string) => {
    const r = resolveLocal(date, time, zone, choice);
    if (!r.ok && r.reason === "gap") errors.push({ path, code: "nonexistent_local_time", message: `${time} doesn't exist on ${date} in ${zone} (clocks change). Pick another time.` });
    if (!r.ok && r.reason === "ambiguous") errors.push({ path: path.replace(/local(Date)?Time$/, "timeDisambiguation"), code: "ambiguous_local_time", message: `${time} happens twice on ${date} in ${zone}. Choose the earlier or later one.` });
    return r.ok ? r.epochMs : null;
  };
  if (input.type === "flight") {
    const d = input.departure;
    const a = input.arrival;
    const dep = d.localDateTime && d.timeZone ? check(d.localDateTime.slice(0, 10), d.localDateTime.slice(11), d.timeZone, d.timeDisambiguation, "departure.localDateTime") : null;
    const arr = a.localDateTime && a.timeZone ? check(a.localDateTime.slice(0, 10), a.localDateTime.slice(11), a.timeZone, a.timeDisambiguation, "arrival.localDateTime") : null;
    if (dep !== null && arr !== null && arr <= dep) errors.push({ path: "arrival.localDateTime", code: "arrival_before_departure", message: "Arrival must be after departure." });
  } else if (input.localDate && input.localTime) {
    check(input.localDate, input.localTime, input.timeZone ?? tripZone, input.timeDisambiguation, "localTime");
  }
  return errors;
}

function mapFields(input: ItemInput, current: PlanItemRow | null): { map_url: string | null; latitude: string | null; longitude: string | null } | FieldError {
  const raw = input.mapUrl;
  // MAP-2: only a changed link is re-read; re-sending the stored link never re-pins.
  if (current && (raw ?? null) === current.map_url) {
    return { map_url: current.map_url, latitude: current.latitude, longitude: current.longitude };
  }
  if (!raw) return { map_url: null, latitude: null, longitude: null };
  const clean = cleanMapUrl(raw);
  if (!clean) return { path: "mapUrl", code: "invalid_url", message: "Use a full https link (at most 2048 characters) without a user name, for example one copied from Google Maps." };
  if (current && clean === current.map_url) return { map_url: current.map_url, latitude: current.latitude, longitude: current.longitude };
  const c = coordinatesFromMapUrl(clean);
  return { map_url: clean, latitude: c ? c[0].toFixed(5) : null, longitude: c ? c[1].toFixed(5) : null };
}

function priceFields(input: ItemInput, current: PlanItemRow | null, confirmPrice: boolean) {
  const p = input.plannedPrice;
  if (!p) return { planned_amount: null, planned_currency: null, price_label: null, price_source: null };
  // BUDGET-4: an AI price stays "unverified" until the owner saves a different amount, currency or label.
  const unchangedAi =
    current?.price_source === "ai" &&
    current.planned_amount !== null &&
    trimAmount(current.planned_amount) === trimAmount(p.amount) &&
    current.planned_currency === p.currency &&
    current.price_label === p.label;
  return { planned_amount: p.amount, planned_currency: p.currency, price_label: p.label, price_source: unchangedAi && !confirmPrice ? ("ai" as const) : ("owner" as const) };
}

export function toValues(input: ItemInput, current: PlanItemRow | null, confirmPrice = false): Values | FieldError {
  const map = mapFields(input, current);
  if ("path" in map) return map;
  const status = input.bookingStatus;
  const base = {
    type: input.type,
    title: input.title,
    location: input.location,
    notes: input.notes,
    links: JSON.stringify(input.links),
    ...map,
    booking_status: status,
    booking_due_date: status === "needs_booking" ? input.bookingDueDate : null,
    ...priceFields(input, current, confirmPrice),
  };
  if (input.type === "flight") {
    return {
      ...base,
      local_date: null, local_time: null, time_zone: null, time_disambiguation: null, duration_minutes: null,
      planned_departure_date: input.departure.localDateTime ? null : input.plannedDepartureDate,
      airline: input.airline,
      flight_number: input.flightNumber,
      departure_airport_code: input.departure.airportCode,
      departure_local_datetime: input.departure.localDateTime,
      departure_time_zone: input.departure.timeZone,
      departure_disambiguation: input.departure.localDateTime ? input.departure.timeDisambiguation : null,
      arrival_airport_code: input.arrival.airportCode,
      arrival_local_datetime: input.arrival.localDateTime,
      arrival_time_zone: input.arrival.timeZone,
      arrival_disambiguation: input.arrival.localDateTime ? input.arrival.timeDisambiguation : null,
    };
  }
  return {
    ...base,
    local_date: input.localDate,
    local_time: input.localDate ? input.localTime : null,
    time_zone: input.timeZone,
    time_disambiguation: input.localTime ? input.timeDisambiguation : null,
    duration_minutes: input.durationMinutes,
    planned_departure_date: null, airline: null, flight_number: null,
    departure_airport_code: null, departure_local_datetime: null, departure_time_zone: null, departure_disambiguation: null,
    arrival_airport_code: null, arrival_local_datetime: null, arrival_time_zone: null, arrival_disambiguation: null,
  };
}
