import type { ItemType, LatLon, MoneyDTO, PlanItemDTO } from "./dto";
import type { ItemInput } from "./schemas";

/*
 * Field-level saves (TRIP-10, DASH-6): the event view and the trip details save what the person changed where they
 * changed it, one field or one section at a time. A save names only the fields it changes and the values those fields
 * had when the edit began, so a change made meanwhile to another field (a connected chat, someone the trip is shared
 * with, another tab) is no clash, while a change to the same field is reported instead of being overwritten.
 */

/** The event fields a field-level save may change: the top-level keys of the item form's shape. */
export const ITEM_FIELDS = [
  "type", "title", "location", "notes", "links", "mapUrl", "bookingStatus", "bookingDueDate", "plannedPrice",
  "localDate", "localTime", "timeZone", "timeDisambiguation", "durationMinutes",
  "plannedDepartureDate", "airline", "flightNumber", "departure", "arrival",
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

/** The trip fields a field-level save may change (DASH-6, ATLAS-4). */
export const TRIP_FIELDS = ["title", "destination", "startDate", "endDate", "timeZone", "budget", "atlasLocation"] as const;
export type TripField = (typeof TRIP_FIELDS)[number];
export type TripFields = { title: string; destination: string; startDate: string; endDate: string; timeZone: string; budget: MoneyDTO | null; atlasLocation: LatLon | null };

const SCHEDULE: Record<"flight" | "other", ItemField[]> = {
  flight: ["plannedDepartureDate", "airline", "flightNumber", "departure", "arrival"],
  other: ["localDate", "localTime", "timeZone", "timeDisambiguation", "durationMinutes"],
};
const EMPTY_ENDPOINT = { airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null };
const EMPTY_SCHEDULE: Record<"flight" | "other", Record<string, unknown>> = {
  flight: { plannedDepartureDate: null, airline: null, flightNumber: null, departure: EMPTY_ENDPOINT, arrival: EMPTY_ENDPOINT },
  other: { localDate: null, localTime: null, timeZone: null, timeDisambiguation: null, durationMinutes: null },
};
const kind = (type: unknown) => (type === "flight" ? "flight" : "other");

/** The stored item in the shape the item form saves, which is what the shared schema checks. */
export function itemInputOf(dto: PlanItemDTO): ItemInput {
  const base = {
    title: dto.title,
    location: dto.location,
    notes: dto.notes,
    links: dto.links,
    mapUrl: dto.mapUrl,
    bookingStatus: dto.bookingStatus,
    bookingDueDate: dto.bookingDueDate,
    plannedPrice: dto.plannedPrice ? { amount: dto.plannedPrice.amount, currency: dto.plannedPrice.currency, label: dto.plannedPrice.label } : null,
  };
  if (dto.type === "flight") {
    const f = dto.flightDetails!;
    return {
      ...base,
      type: "flight",
      plannedDepartureDate: f.plannedDepartureDate,
      airline: f.airline,
      flightNumber: f.flightNumber,
      departure: { ...f.departure },
      arrival: { ...f.arrival },
    };
  }
  return {
    ...base,
    type: dto.type as Exclude<ItemType, "flight">,
    localDate: dto.localDate,
    localTime: dto.localTime,
    timeZone: dto.timeZone,
    timeDisambiguation: dto.timeDisambiguation,
    durationMinutes: dto.durationMinutes,
  };
}

/** A trip's editable fields, from the trip page's trip or the stored row in the same shape. */
export function tripFieldsOf(trip: Omit<TripFields, "atlasLocation"> & { atlasLocation: LatLon | null }): TripFields {
  return {
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    timeZone: trip.timeZone,
    budget: trip.budget ? { amount: trip.budget.amount, currency: trip.budget.currency } : null,
    atlasLocation: trip.atlasLocation ? { latitude: trip.atlasLocation.latitude, longitude: trip.atlasLocation.longitude } : null,
  };
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v === undefined ? null : v;
}

/** Whether two JSON values are the same, whatever the order of their object keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/**
 * Merges a field-level save onto the current values. Every changed field must still hold the value it had when the
 * edit began (`base`); the ones that don't are returned as conflicts and nothing is merged.
 */
export function mergeFields<T extends object>(current: T, changes: Record<string, unknown>, base: Record<string, unknown>): { merged: Record<string, unknown>; conflicts: string[] } {
  const now = current as Record<string, unknown>;
  const conflicts = Object.keys(changes).filter((k) => !sameValue(base[k], now[k]));
  return conflicts.length ? { merged: { ...now }, conflicts } : { merged: { ...now, ...changes }, conflicts };
}

/**
 * The same for an event. A change to or from a flight swaps its schedule fields: the old kind's are dropped and the new
 * kind's start empty unless the save sets them, which is the "clears the schedule" the person confirms (TRIP-9).
 */
export function mergeItemFields(current: ItemInput, changes: Record<string, unknown>, base: Record<string, unknown>): { merged: Record<string, unknown>; conflicts: string[] } {
  const result = mergeFields(current, changes, base);
  if (result.conflicts.length) return result;
  const from = kind(current.type);
  const to = kind(result.merged.type);
  if (from === to) return result;
  const merged = { ...result.merged };
  for (const key of SCHEDULE[from]) delete merged[key];
  for (const [key, empty] of Object.entries(EMPTY_SCHEDULE[to])) if (!(key in changes)) merged[key] = empty;
  return { merged, conflicts: [] };
}
