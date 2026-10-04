/**
 * Calendar and time-zone rules (technical design: Domain rules, Time zones). Local wall-clock values
 * are never parsed as UTC; conversion to an instant always uses an IANA zone.
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const ZONE_NAME = /^(UTC|[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*(?:\/[A-Za-z0-9_+-]+)*)$/;

export type Disambiguation = "earlier" | "later";

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

export function isLocalDateTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATETIME_PATTERN.test(value) && isDate(value.slice(0, 10));
}

const zoneCache = new Map<string, boolean>();
/** IANA zone name accepted by the runtime; offsets such as "+05:00" are rejected. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 || !ZONE_NAME.test(value)) return false;
  const hit = zoneCache.get(value);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    ok = true;
  } catch {
    ok = false;
  }
  if (zoneCache.size > 1000) zoneCache.clear(); // bounded: names come from user input
  zoneCache.set(value, ok);
  return ok;
}

let zoneNames: Map<string, string> | null = null;
/** Canonical spelling of a valid zone name ("asia/tokyo" → "Asia/Tokyo"); aliases are kept as given. */
export function canonicalTimeZone(value: string): string {
  if (!zoneNames) {
    zoneNames = new Map([["utc", "UTC"]]);
    try {
      for (const z of Intl.supportedValuesOf("timeZone")) zoneNames.set(z.toLowerCase(), z);
    } catch {}
  }
  return zoneNames.get(value.toLowerCase()) ?? value;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(zone, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number };

function wallClock(zone: string, epochMs: number): Wall {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute! };
}

function offsetMs(zone: string, epochMs: number): number {
  const w = wallClock(zone, epochMs);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return asUtc - Math.floor(epochMs / 60000) * 60000;
}

/** Local calendar date ("YYYY-MM-DD") in a zone at an instant. */
export function dateInZone(zone: string, epochMs: number): string {
  const w = wallClock(zone, epochMs);
  return `${String(w.y).padStart(4, "0")}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/**
 * All instants at which the wall clock in `zone` reads date + time.
 * Returns [] for a daylight-saving gap, two values for a repeated (overlap) time.
 */
export function localCandidates(date: string, time: string, zone: string): number[] {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([offsetMs(zone, naive - 86_400_000), offsetMs(zone, naive), offsetMs(zone, naive + 86_400_000)]);
  const out: number[] = [];
  for (const off of offsets) {
    const t = naive - off;
    const w = wallClock(zone, t);
    if (w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

export type InstantResult =
  | { ok: true; epochMs: number; ambiguous: boolean }
  | { ok: false; reason: "gap" | "ambiguous" };

/** Resolve a local time to one instant, requiring a choice for repeated times. */
export function resolveLocal(date: string, time: string, zone: string, choice: Disambiguation | null): InstantResult {
  const c = localCandidates(date, time, zone);
  if (c.length === 0) return { ok: false, reason: "gap" };
  if (c.length === 1) return { ok: true, epochMs: c[0]!, ambiguous: false };
  if (!choice) return { ok: false, reason: "ambiguous" };
  return { ok: true, epochMs: choice === "earlier" ? c[0]! : c[c.length - 1]!, ambiguous: true };
}

export type TripStatus = "upcoming" | "ongoing" | "past";

/** Whole days from `a` to `b` (both "YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** DASH-2: status from the trip's local "today"; the end date is inclusive. */
export function tripStatus(start: string, end: string, today: string): TripStatus {
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "ongoing";
}

export type DueState = "upcoming" | "due_today" | "overdue";
export function dueState(due: string, today: string): DueState {
  if (today < due) return "upcoming";
  if (today === due) return "due_today";
  return "overdue";
}

/** Longest trip, in days including both ends. The trip page draws one day tab per date. */
export const MAX_TRIP_DAYS = 400;

/** Whether an inclusive range fits MAX_TRIP_DAYS. Call it only with valid dates. */
export function withinTripLength(start: string, end: string): boolean {
  return daysBetween(start, end) < MAX_TRIP_DAYS;
}

/** All dates from start to end inclusive (bounded). */
export function dateRange(start: string, end: string, max = MAX_TRIP_DAYS): string[] {
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < max; d = addDays(d, 1), i++) out.push(d);
  return out;
}
