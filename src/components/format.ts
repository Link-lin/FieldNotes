import type { TripSummaryDTO } from "@/shared/dto";

// Calendar strings are formatted by hand so server and browser render identical text
// (ICU data differs between Node and browsers) and the viewer's own zone never shifts a date.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return { y, m, day, wd: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
};

export const fmtDay = (d: string) => {
  const p = parts(d);
  return `${WEEKDAYS[p.wd]} ${p.day} ${MONTHS[p.m - 1]}`;
};
export const fmtShort = (d: string) => {
  const p = parts(d);
  return `${p.day} ${MONTHS[p.m - 1]}`;
};
export const fmtMonth = (d: string) => (MONTHS[parts(d).m - 1] ?? "").toUpperCase();
export const dotted = (d: string) => d.replace(/-/g, ".");

export function dateRangeLabel(t: { startDate: string; endDate: string }): string {
  const end = t.startDate.slice(0, 4) === t.endDate.slice(0, 4) ? dotted(t.endDate).slice(5) : dotted(t.endDate);
  return `${dotted(t.startDate)} — ${end}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Relative wording in the trip's own time zone (the server computes the day counts). */
export function relativeLabel(t: TripSummaryDTO): string {
  if (t.status === "upcoming") return t.daysToStart === 1 ? "tomorrow" : `in ${t.daysToStart} days`;
  if (t.status === "ongoing") return `day ${t.dayIndex} of ${t.dayCount}`;
  const n = t.daysSinceEnd;
  if (n === null) return "ended";
  if (n === 1) return "yesterday";
  return n > 60 ? `${Math.round(n / 30)} months ago` : `${plural(n, "day")} ago`;
}

export const STATUS_LABEL = { upcoming: "Upcoming", ongoing: "Ongoing", past: "Past" } as const;
export const TYPE_LABEL = { flight: "Flight", lodging: "Stay", transport: "Transport", meal: "Meal", activity: "Activity", other: "Other" } as const;
