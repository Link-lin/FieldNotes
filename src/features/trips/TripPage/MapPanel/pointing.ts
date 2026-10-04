import type { MapFocus } from "./map-focus";

/** The few things the rules below ask of an element (a DOM element has them all), so they can be tested without a browser. */
export type Pointable = {
  closest(selector: string): Pointable | null;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  contains(other: unknown): boolean;
};

export type Pointing = {
  /** Light, or put out, every place a stop shows: its row, its stop-list line and its marker (MAP-5). */
  light: { id: string; on: boolean } | null;
  /** What the map should look at: a stop or day, nothing (it goes back), or undefined for no change. */
  look: MapFocus | null | undefined;
};

/**
 * What a mouseover, mouseout, focusin or focusout on the trip page means for the linked highlight and for the map.
 *
 * - A timeline row or stop-list line (`data-hl`) lights its stop and points the map at it; so does a day heading, a day
 *   label in the stop list or a day tab (`data-hl-day`) for its day.
 * - A marker on the map lights its stop but doesn't move the map: it is already there, and the map moving from under the
 *   pointer isn't wanted.
 * - Moving the pointer onto anything else points at nothing, so a highlight can't be left behind (an element removed
 *   from under the pointer never says it was left).
 * - Leaving an element for something inside it isn't leaving.
 * - A touch screen has no hover: the mouseover its tap sends, which stays until the next tap, doesn't move the map.
 * - Focus moves the map only when it came by keyboard (`:focus-visible`), not from a click, which would otherwise leave
 *   the map zoomed to a row the pointer has long since left.
 */
export function pointing(e: { type: string; target: Pointable; relatedTarget: unknown }, canHover: boolean): Pointing {
  const on = e.type === "mouseover" || e.type === "focusin";
  const mouse = e.type.startsWith("mouse");
  const aim = (host: Pointable, at: MapFocus): MapFocus | null | undefined => {
    if (mouse && !canHover) return undefined;
    if (on) return !mouse && !e.target.matches(":focus-visible") ? undefined : at;
    return host.contains(e.relatedTarget) ? undefined : null;
  };
  const stop = e.target.closest("[data-hl]");
  if (stop) {
    const id = stop.getAttribute("data-hl")!;
    return { light: { id, on }, look: stop.closest("svg") ? undefined : aim(stop, { kind: "event", id }) };
  }
  const day = e.target.closest("[data-hl-day]");
  if (day) return { light: null, look: aim(day, { kind: "day", day: day.getAttribute("data-hl-day")! }) };
  return { light: null, look: on && mouse && canHover ? null : undefined };
}
