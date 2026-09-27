/**
 * Time-zone choices for the trip form. The short list has one or two well-known places per
 * zone, like a calendar app; a separate zone appears only where the clock rules differ
 * (Phoenix has no daylight saving, Los Angeles does). The full IANA list stays available.
 */
export const COMMON_ZONES: ReadonlyArray<readonly [zone: string, places: string]> = [
  ["Pacific/Pago_Pago", "Pago Pago"],
  ["Pacific/Honolulu", "Honolulu"],
  ["America/Anchorage", "Anchorage"],
  ["America/Los_Angeles", "Los Angeles, Vancouver"],
  ["America/Phoenix", "Phoenix"],
  ["America/Denver", "Denver, Calgary"],
  ["America/Mexico_City", "Mexico City"],
  ["America/Chicago", "Chicago"],
  ["America/New_York", "New York, Toronto"],
  ["America/Bogota", "Bogotá, Lima"],
  ["America/Caracas", "Caracas"],
  ["America/Halifax", "Halifax, Bermuda"],
  ["America/Santiago", "Santiago"],
  ["America/St_Johns", "St. John's"],
  ["America/Sao_Paulo", "São Paulo, Rio de Janeiro"],
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["Atlantic/Azores", "Azores"],
  ["Atlantic/Cape_Verde", "Cape Verde"],
  ["UTC", "Coordinated Universal Time"],
  ["Atlantic/Reykjavik", "Reykjavík"],
  ["Europe/London", "London, Dublin"],
  ["Europe/Lisbon", "Lisbon"],
  ["Africa/Casablanca", "Casablanca"],
  ["Africa/Lagos", "Lagos"],
  ["Europe/Paris", "Paris, Berlin, Rome"],
  ["Africa/Cairo", "Cairo"],
  ["Africa/Johannesburg", "Johannesburg"],
  ["Europe/Athens", "Athens, Helsinki"],
  ["Asia/Jerusalem", "Jerusalem"],
  ["Europe/Istanbul", "Istanbul"],
  ["Europe/Moscow", "Moscow"],
  ["Africa/Nairobi", "Nairobi"],
  ["Asia/Riyadh", "Riyadh, Doha"],
  ["Asia/Tehran", "Tehran"],
  ["Asia/Dubai", "Dubai"],
  ["Asia/Kabul", "Kabul"],
  ["Asia/Karachi", "Karachi"],
  ["Asia/Tashkent", "Tashkent"],
  ["Asia/Kolkata", "Mumbai, Delhi"],
  ["Asia/Kathmandu", "Kathmandu"],
  ["Asia/Dhaka", "Dhaka"],
  ["Asia/Yangon", "Yangon"],
  ["Asia/Bangkok", "Bangkok, Jakarta"],
  ["Asia/Singapore", "Singapore, Kuala Lumpur"],
  ["Asia/Shanghai", "Beijing, Shanghai"],
  ["Asia/Hong_Kong", "Hong Kong"],
  ["Asia/Taipei", "Taipei"],
  ["Australia/Perth", "Perth"],
  ["Asia/Seoul", "Seoul"],
  ["Asia/Tokyo", "Tokyo, Osaka"],
  ["Australia/Darwin", "Darwin"],
  ["Australia/Adelaide", "Adelaide"],
  ["Australia/Brisbane", "Brisbane"],
  ["Australia/Sydney", "Sydney, Melbourne"],
  ["Pacific/Guam", "Guam"],
  ["Pacific/Noumea", "Nouméa"],
  ["Pacific/Auckland", "Auckland"],
  ["Pacific/Fiji", "Fiji"],
  ["Pacific/Tongatapu", "Tonga"],
];

const COMMON = new Map(COMMON_ZONES.map(([z, p]) => [z, p]));

/** Current offset from UTC in minutes, or null if the runtime doesn't know the zone. */
export function offsetMinutes(zone: string, at = new Date()): number | null {
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at).find((x) => x.type === "timeZoneName")?.value ?? "";
    const m = v.match(/GMT(?:([+-])(\d{2}):?(\d{2})?)?/);
    if (!m) return null;
    return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  } catch {
    return null;
  }
}

/** "GMT+9", "GMT+5:30", "GMT-7" or "GMT". */
export function gmt(zone: string, at = new Date()): string {
  const m = offsetMinutes(zone, at);
  if (m === null) return "";
  if (m === 0) return "GMT";
  const a = Math.abs(m);
  return `GMT${m < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

/** Place names for a zone: the short list's names, or the zone's own city ("Argentina/Ushuaia" → "Ushuaia, Argentina"). */
export function zonePlaces(zone: string): string {
  const known = COMMON.get(zone);
  if (known) return known;
  const parts = zone.split("/").map((s) => s.replace(/_/g, " "));
  return parts.length > 2 ? `${parts[parts.length - 1]}, ${parts[1]}` : parts[parts.length - 1]!;
}

/** "GMT-7 · Los Angeles, Vancouver". */
export function zoneLabel(zone: string, at = new Date()): string {
  const off = gmt(zone, at);
  return off ? `${off} · ${zonePlaces(zone)}` : zonePlaces(zone);
}

/** The short list, ordered by current offset (west to east). */
export function commonZones(at = new Date()): Array<{ id: string; label: string }> {
  return COMMON_ZONES.map(([z]) => ({ z, off: offsetMinutes(z, at) }))
    .filter((x): x is { z: string; off: number } => x.off !== null)
    .sort((a, b) => a.off - b.off)
    .map(({ z }) => ({ id: z, label: zoneLabel(z, at) }));
}
