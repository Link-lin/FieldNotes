/*
 * The trip page's panels as its address names them (TRIP-1): `?event=<id>`, `?add=<date>` (or `all`), `?trip=details`
 * (or `budget`, `globe`) and `?share=1`. Read on the server for the first render and in the browser on Back and Forward.
 */

/** Which part of the trip details opens first: everything, or the budget or globe point ready to change. */
export type TripFocus = "details" | "budget" | "globe";

/** A panel the trip page can show, as its address says it. */
export type PanelRequest = { kind: "event"; id: string; focusTitle?: boolean } | { kind: "add"; date: string } | { kind: "trip"; focus: TripFocus } | { kind: "share" };

const FOCUS: readonly TripFocus[] = ["details", "budget", "globe"];

/** The panel a trip page address asks for, if any. */
export function panelFromParams(q: { event?: string | null; add?: string | null; trip?: string | null; share?: string | null }): PanelRequest | null {
  if (q.event) return { kind: "event", id: q.event };
  if (q.add) return { kind: "add", date: /^\d{4}-\d{2}-\d{2}$/.test(q.add) ? q.add : "" };
  if (q.trip) return { kind: "trip", focus: FOCUS.includes(q.trip as TripFocus) ? (q.trip as TripFocus) : "details" };
  if (q.share) return { kind: "share" };
  return null;
}
