/*
 * The trip page's panels as its address names them (TRIP-1): `?event=<id>`, `?add=<date>` (or `all`), `?trip=details`
 * (or `budget`, `globe`) and `?share=1`. Read in the browser, from the address as it is now: Back to a page restores its
 * first render, whose panel may have been closed since.
 */

/** Which part of the trip details opens first: everything, or the budget or globe point ready to change. */
export type TripFocus = "details" | "budget" | "globe";

/** A panel the trip page can show, as its address says it. */
export type PanelRequest = { kind: "event"; id: string; focusTitle?: boolean } | { kind: "add"; date: string } | { kind: "trip"; focus: TripFocus } | { kind: "share" };

const FOCUS: readonly TripFocus[] = ["details", "budget", "globe"];

/** The panel a trip page address (its query string) asks for, if any. */
export function panelFromSearch(search: string): PanelRequest | null {
  const q = new URLSearchParams(search);
  if (q.get("event")) return { kind: "event", id: q.get("event")! };
  const add = q.get("add");
  if (add) return { kind: "add", date: /^\d{4}-\d{2}-\d{2}$/.test(add) ? add : "" };
  const trip = q.get("trip");
  if (trip) return { kind: "trip", focus: FOCUS.includes(trip as TripFocus) ? (trip as TripFocus) : "details" };
  if (q.get("share")) return { kind: "share" };
  return null;
}
