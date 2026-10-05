import type { FieldError, ItemType, PlanItemDTO } from "@/shared/dto";
import { sameValue } from "@/shared/fields";
import { api } from "@/lib/api";
import type { FieldSaveResult } from "@/lib/use-inline-field";

/*
 * The event view edits an event where it shows it (TRIP-10): each section or value keeps a draft in the form's own
 * shape (strings for inputs), turns it into item fields to save, and sends only the fields that changed together with
 * the values they had when the edit began. The add form builds the whole event from the same drafts.
 */

export type Choice = "" | "earlier" | "later";
/** One end of a flight segment as typed. */
export type Endpoint = { code: string; dt: string; zone: string; choice: Choice };
export type WhenDraft = { noDate: boolean; date: string; time: string; zone: string; choice: Choice; duration: string };
export type FlightDraft = { airline: string; flightNumber: string; plannedDate: string; dep: Endpoint; arr: Endpoint };
export type PlaceDraft = { location: string; mapUrl: string };
export type BookingDraft = { status: PlanItemDTO["bookingStatus"]; due: string };
export type PriceDraft = { amount: string; currency: string; label: "estimate" | "quote" };

export const whenDraftOf = (item: PlanItemDTO | null, defaultDate = ""): WhenDraft => ({
  noDate: item ? !item.localDate : false,
  date: item ? (item.localDate ?? "") : defaultDate,
  time: item?.localTime ?? "",
  zone: item?.timeZone ?? "",
  choice: item?.timeDisambiguation ?? "",
  duration: item?.durationMinutes ? String(item.durationMinutes) : "",
});
export const whenFields = (d: WhenDraft) => ({
  localDate: d.noDate ? null : d.date || null,
  localTime: d.noDate || !d.date ? null : d.time || null,
  timeZone: d.zone || null,
  timeDisambiguation: d.time && d.choice ? d.choice : null,
  durationMinutes: d.duration ? Number(d.duration) : null,
});

const endpointOf = (e?: { airportCode: string | null; localDateTime: string | null; timeZone: string | null; timeDisambiguation: "earlier" | "later" | null }): Endpoint => ({
  code: e?.airportCode ?? "",
  dt: e?.localDateTime ?? "",
  zone: e?.timeZone ?? "",
  choice: e?.timeDisambiguation ?? "",
});
const endpointFields = (x: Endpoint) => ({ airportCode: x.code.trim() || null, localDateTime: x.dt || null, timeZone: x.zone || null, timeDisambiguation: x.dt && x.choice ? x.choice : null });

export const flightDraftOf = (item: PlanItemDTO | null, defaultDate = ""): FlightDraft => {
  const f = item?.flightDetails;
  return { airline: f?.airline ?? "", flightNumber: f?.flightNumber ?? "", plannedDate: f ? (f.plannedDepartureDate ?? "") : defaultDate, dep: endpointOf(f?.departure), arr: endpointOf(f?.arrival) };
};
export const flightFields = (d: FlightDraft) => ({
  plannedDepartureDate: d.dep.dt ? null : d.plannedDate || null,
  airline: d.airline.trim() || null,
  flightNumber: d.flightNumber.trim() || null,
  departure: endpointFields(d.dep),
  arrival: endpointFields(d.arr),
});

export const placeDraftOf = (item: PlanItemDTO | null): PlaceDraft => ({ location: item?.location ?? "", mapUrl: item?.mapUrl ?? "" });
export const placeFields = (d: PlaceDraft) => ({ location: d.location.trim() || null, mapUrl: d.mapUrl.trim() || null });

export const bookingDraftOf = (item: PlanItemDTO | null, type: ItemType = item?.type ?? "activity"): BookingDraft => ({
  status: item?.bookingStatus ?? (type === "flight" ? "needs_booking" : "not_required"),
  due: item?.bookingDueDate ?? "",
});
/**
 * The booking state an event keeps when its type changes (FLIGHT-2): a flight either needs booking or is booked, and is
 * booked only with both airports, local times and zones. An event becoming a flight starts without them, so Nothing to
 * book and Booked both become Needs booking.
 */
export function bookingForType(status: PlanItemDTO["bookingStatus"], toFlight: boolean, flightReady = false): PlanItemDTO["bookingStatus"] {
  if (!toFlight) return status;
  if (status === "not_required") return "needs_booking";
  if (status === "booked" && !flightReady) return "needs_booking";
  return status;
}
export const bookingFields = (d: BookingDraft) => ({ bookingStatus: d.status, bookingDueDate: d.status === "needs_booking" && d.due ? d.due : null });

export const priceDraftOf = (item: PlanItemDTO | null, defaultCurrency: string): PriceDraft => ({
  amount: item?.plannedPrice?.amount ?? "",
  currency: item?.plannedPrice?.currency ?? defaultCurrency,
  label: item?.plannedPrice?.label ?? "estimate",
});
export const priceFields = (d: PriceDraft) => ({ plannedPrice: d.amount.trim() ? { amount: d.amount.trim(), currency: d.currency, label: d.label } : null });

/** The fields whose value differs from where the edit began. */
export function changedFields(next: Record<string, unknown>, start: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => !sameValue(v, start[k])));
}

/** Server field paths to the id of the control that shows them, for focus after a failed save. */
export const fieldId = (path: string) => `ev-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
export const errorId = (path: string) => `${fieldId(path)}-err`;

export type EventSaveResult = { ok: true; item: PlanItemDTO } | { ok: false; status: number; code: string; message: string; fields: FieldError[] };

/** Saves the changed fields of an event (TRIP-10), each with the value it had when the edit began. */
export async function saveEventFields(tripId: string, itemId: string, next: Record<string, unknown>, start: Record<string, unknown>, opts: { confirmTypeChange?: boolean; confirmPrice?: boolean } = {}): Promise<EventSaveResult> {
  const changes = changedFields(next, start);
  if (!Object.keys(changes).length && !opts.confirmPrice) return { ok: false, status: 0, code: "unchanged", message: "Nothing changed.", fields: [] };
  const base = Object.fromEntries(Object.keys(changes).map((k) => [k, start[k] ?? null]));
  const body = Object.keys(changes).length ? { changes, base, ...opts } : { changes: { plannedPrice: start.plannedPrice ?? null }, base: { plannedPrice: start.plannedPrice ?? null }, ...opts };
  const r = await api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${itemId}/fields`, body);
  return r.ok ? { ok: true, item: r.data } : r;
}

/** What a failed save tells the person, as a field's or section's message. */
export function saveFailure(r: Extract<EventSaveResult, { ok: false }>): Extract<FieldSaveResult, { ok: false }> {
  if (r.code === "field_conflict") {
    return { ok: false, conflict: true, message: "This was changed elsewhere (in another tab or window, by someone you share the trip with, or by a connected chat) while you were editing, so yours wasn't saved. Cancel to see it as it is now, then make your change again.", fields: r.fields };
  }
  return { ok: false, message: r.message, fields: r.fields };
}
