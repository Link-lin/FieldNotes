import "server-only";
import type { PlanItemDTO, PlannedTotalDTO, TripDetailDTO, TripSummaryDTO } from "@/shared/dto";

/*
 * What a connected AI chat sees (CONNECT-6, CONNECT-7): compact JSON in one text block, null and empty fields left out, in
 * the vocabulary of the JSON v1 import so the model can send back what it read. Long text is cut so a result stays
 * well inside the chat provider's size limit.
 */

/** Claude accepts about 150,000 characters of tool result; stay clear of it. */
export const MAX_RESULT_CHARS = 100_000;
const NOTES_IN_LISTS = 400;

const BOOKING = { needs_booking: "Needs booking", not_required: "Not required", booked: "Booked" } as const;

/** Drops null, undefined and empty arrays or objects, so a result carries only what is set. */
function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compact(v);
      if (c === null || c === undefined) continue;
      if (Array.isArray(c) && c.length === 0) continue;
      if (typeof c === "object" && !Array.isArray(c) && Object.keys(c as object).length === 0) continue;
      out[key] = c;
    }
    return out as T;
  }
  return value;
}

export const toJson = (value: unknown): string => JSON.stringify(compact(value));

/** One item as the model reads it. `notesLimit` shortens notes in a trip listing; `get_item` passes none. */
export function itemView(item: PlanItemDTO, notesLimit?: number) {
  const cut = notesLimit !== undefined && item.notes !== null && item.notes.length > notesLimit;
  const f = item.flightDetails;
  return compact({
    id: item.id,
    type: item.type,
    title: item.title,
    localDate: item.localDate,
    localTime: item.localTime,
    timeZone: item.timeZone,
    durationMinutes: item.durationMinutes,
    location: item.location,
    notes: cut ? `${item.notes!.slice(0, notesLimit)}…` : item.notes,
    notesTruncated: cut ? true : undefined,
    links: item.links,
    bookingStatus: BOOKING[item.bookingStatus],
    bookByDate: item.bookingDueDate,
    bookingDue: item.bookingDueState,
    plannedPrice: item.plannedPrice ? { amount: item.plannedPrice.amount, currency: item.plannedPrice.currency, label: item.plannedPrice.label, setBy: item.plannedPrice.source === "ai" ? "ai" : "person" } : null,
    addedBy: item.source === "ai" ? "ai" : "person",
    // An AI item the person has checked and kept (IMPORT-7); absent while it is still an unverified draft.
    reviewedByPerson: item.source === "ai" && item.reviewedAt ? true : undefined,
    onMap: item.coordinates ? true : undefined,
    flightDetails: f
      ? {
          plannedDepartureDate: f.plannedDepartureDate,
          airline: f.airline,
          flightNumber: f.flightNumber,
          departure: { airportCode: f.departure.airportCode, localDateTime: f.departure.localDateTime, timeZone: f.departure.timeZone },
          arrival: { airportCode: f.arrival.airportCode, localDateTime: f.arrival.localDateTime, timeZone: f.arrival.timeZone },
        }
      : null,
  });
}

export function tripView(trip: TripSummaryDTO) {
  return compact({
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    timeZone: trip.timeZone,
    status: trip.status,
    role: trip.role,
  });
}

export const tripListView = (trips: TripSummaryDTO[]) => ({ trips: trips.map(tripView) });

const totalView = (t: PlannedTotalDTO) => ({ currency: t.currency, total: t.total, ofWhichAiEstimates: t.unverifiedCount });

/**
 * A trip with its items in page order. Items go in until the result would pass the cap; the rest are counted, so the
 * model knows the list is partial and can ask for one item with `get_item`.
 */
export function tripDetailJson(detail: TripDetailDTO): string {
  const head = compact({
    trip: { ...tripView(detail.trip), today: detail.trip.today, budget: detail.trip.budget },
    plannedTotals: detail.plannedTotals.map(totalView),
    budgetComparison: detail.budgetComparison,
  }) as Record<string, unknown>;
  const items: unknown[] = [];
  let size = JSON.stringify(head).length + 100;
  for (const item of detail.items) {
    const view = itemView(item, NOTES_IN_LISTS);
    const length = JSON.stringify(view).length + 1;
    if (size + length > MAX_RESULT_CHARS) break;
    items.push(view);
    size += length;
  }
  const omitted = detail.items.length - items.length;
  return JSON.stringify({ ...head, items, ...(omitted > 0 ? { omittedItems: omitted, note: "The list was too long to return in full; call get_item for any item that is missing." } : {}) });
}
