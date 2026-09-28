import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { haversineKm } from "@/shared/map-links";
import { addDays, dateRange } from "@/shared/time";
import { fmtDay } from "@/lib/format";

type Trip = TripDetailDTO["trip"];

/** A numbered map stop. Numbers run across the whole trip, so a day tab shows the same ones. */
/** `airport` is set when a flight's pin comes from the bundled airport list; the road map names it. */
export type Stop = { id: string; n: number; name: string; lat: number; lon: number; flight: boolean; airport: string | null; need: boolean; day: string; dayLabel: string };

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const isOutside = (trip: Trip, d: string) => d < trip.startDate || d > trip.endDate;
/** 1-based day number from the trip start date. */
export const dayNumber = (trip: Trip, d: string) => Math.round((Date.parse(d) - Date.parse(trip.startDate)) / 86_400_000) + 1;
export const dayTag = (trip: Trip, d: string) => (isOutside(trip, d) ? "Outside trip dates" : `Day ${pad2(dayNumber(trip, d))}`);

/** Items by timeline date, the trip's own dates, and every tab date (TRIP-2: trip range plus any item date outside it). */
export function tripDays(trip: Trip, items: PlanItemDTO[]) {
  const byDate = new Map<string, PlanItemDTO[]>();
  for (const i of items) if (i.timelineDate) byDate.set(i.timelineDate, [...(byDate.get(i.timelineDate) ?? []), i]);
  const inRange = dateRange(trip.startDate, trip.endDate);
  const days = [...new Set([...inRange, ...byDate.keys()])].sort();
  return { byDate, inRange, days };
}

/** Stops in timeline order (timed, then unscheduled; undated items are not on the map). */
export function tripStops(trip: Trip, byDate: Map<string, PlanItemDTO[]>, days: string[]): Stop[] {
  const out: Stop[] = [];
  for (const d of days)
    for (const i of byDate.get(d) ?? [])
      if (i.coordinates)
        out.push({
          id: i.id,
          n: out.length + 1,
          name: i.flightDetails ? `Arrive ${i.flightDetails.arrival.airportCode}` : i.location?.split(",")[0] || i.title,
          lat: i.coordinates.latitude,
          lon: i.coordinates.longitude,
          flight: !!i.flightDetails,
          airport: i.coordinates.source === "airport" ? (i.flightDetails?.arrival.airportCode ?? null) : null,
          need: i.bookingStatus === "needs_booking",
          day: d,
          dayLabel: `${dayTag(trip, d)} · ${fmtDay(d)}`,
        });
  return out;
}

/** Straight-line distance between consecutive non-flight stops of the same day (MAP-4). */
export function straightLineKm(stops: Stop[]): number {
  let km = 0;
  stops.forEach((s, i) => {
    const p = stops[i - 1];
    if (p && p.day === s.day && !p.flight && !s.flight) km += haversineKm([p.lat, p.lon], [s.lat, s.lon]);
  });
  return km;
}

/** The time shown for an event: its local time (and zone when not the trip's), or why there is none. */
export function eventTimeText(item: PlanItemDTO, tripZone: string): string {
  if (item.flightDetails) {
    const d = item.flightDetails.departure;
    if (d.localDateTime) return `${d.localDateTime.slice(11)}${d.timeZone && d.timeZone !== tripZone ? ` (${d.timeZone})` : ""}`;
    return item.timelineDate ? "Time not set" : "No date";
  }
  if (!item.localDate) return "No date";
  if (!item.localTime) return "Time not set";
  return `${item.localTime}${item.timeZone && item.timeZone !== tripZone ? ` (${item.timeZone})` : ""}${item.durationMinutes ? ` · ${item.durationMinutes} min` : ""}`;
}

/**
 * The event the header's Up next card shows: the first dated event from today (trip zone) in
 * timeline order. `now` (the browser's clock, known only after hydration) also skips today's timed
 * events that have already started. Past trips have none.
 */
export function upNext(trip: Trip, items: PlanItemDTO[], now: number | null): { item: PlanItemDTO; label: string } | null {
  if (trip.status === "past") return null;
  const item = items.find((i) => {
    if (!i.timelineDate || i.timelineDate < trip.today) return false;
    if (i.timelineDate > trip.today || now === null || !i.sortInstant) return true;
    return Date.parse(i.sortInstant) >= now;
  });
  if (!item) return null;
  const date = item.timelineDate!;
  return { item, label: date === trip.today ? "Today" : date === addDays(trip.today, 1) ? "Tomorrow" : fmtDay(date) };
}

/** The dated flights as one route line, "SFO → HNL → OGG"; a gap between segments starts a new run. */
export function flightRoute(items: PlanItemDTO[]): string | null {
  const runs: string[][] = [];
  for (const i of items) {
    const dep = i.flightDetails?.departure.airportCode;
    const arr = i.flightDetails?.arrival.airportCode;
    if (!i.timelineDate || !dep || !arr) continue;
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === dep) run.push(arr);
    else runs.push([dep, arr]);
  }
  return runs.length ? runs.map((run) => run.join(" → ")).join(" · ") : null;
}
