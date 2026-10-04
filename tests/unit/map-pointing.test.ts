import { describe, expect, it } from "vitest";
import { pointing, type Pointable } from "@/features/trips/TripPage/MapPanel/pointing";

/** A stand-in for a DOM element: a tag, attributes, a parent, and whether keyboard focus on it would show a focus ring. */
type Fake = Pointable & { tag: string; attrs: Record<string, string>; parent: Fake | null; focusVisible: boolean };
const hit = (e: Fake, selector: string) => (selector === "svg" ? e.tag === "svg" : selector.startsWith("[") && selector.slice(1, -1) in e.attrs);
function el(tag: string, attrs: Record<string, string> = {}, parent: Fake | null = null, focusVisible = false): Fake {
  const n: Fake = {
    tag,
    attrs,
    parent,
    focusVisible,
    closest(selector) {
      for (let e: Fake | null = n; e; e = e.parent) if (hit(e, selector)) return e;
      return null;
    },
    getAttribute: (name) => n.attrs[name] ?? null,
    matches: (selector) => (selector === ":focus-visible" ? n.focusVisible : hit(n, selector)),
    contains(other) {
      for (let e = other as Fake | null; e; e = e.parent) if (e === n) return true;
      return false;
    },
  };
  return n;
}

const page = el("div");
const row = el("li", { "data-hl": "stop-1" }, page);
const inRow = el("span", {}, row);
const otherRow = el("li", { "data-hl": "stop-2" }, page);
const list = el("svg", {}, page);
const pin = el("g", { "data-hl": "stop-1", "data-pin": "stop-1" }, list);
const onPin = el("text", {}, pin);
const heading = el("div", { "data-hl-day": "2026-10-26" }, page);
const inHeading = el("h2", {}, heading);
const tab = el("button", { "data-hl-day": "2026-10-27" }, page);
const blank = el("p", {}, page);
const event = (type: string, target: Fake, relatedTarget: unknown = null) => ({ type, target, relatedTarget });
const HOVER = true;

describe("what the pointer or focus means for the highlight and the map", () => {
  it("lights a stop and points the map at it when the pointer comes onto its row or line", () => {
    expect(pointing(event("mouseover", inRow), HOVER)).toEqual({ light: { id: "stop-1", on: true }, look: { kind: "event", id: "stop-1" } });
  });

  it("puts the light out and sends the map back when the pointer leaves the row for somewhere else, or out of the window", () => {
    expect(pointing(event("mouseout", inRow, blank), HOVER)).toEqual({ light: { id: "stop-1", on: false }, look: null });
    expect(pointing(event("mouseout", row, otherRow), HOVER)).toEqual({ light: { id: "stop-1", on: false }, look: null });
    expect(pointing(event("mouseout", row, null), HOVER).look).toBeNull();
  });

  it("doesn't count moving from one part of a row to another as leaving it", () => {
    expect(pointing(event("mouseout", row, inRow), HOVER).look).toBeUndefined();
    expect(pointing(event("mouseout", inRow, row), HOVER).look).toBeUndefined();
  });

  it("lights a stop for its marker without moving the map from under the pointer", () => {
    expect(pointing(event("mouseover", onPin), HOVER)).toEqual({ light: { id: "stop-1", on: true }, look: undefined });
    expect(pointing(event("mouseout", onPin, blank), HOVER)).toEqual({ light: { id: "stop-1", on: false }, look: undefined });
  });

  it("points the map at a day from its heading, its label in the stop list or its tab, and sends it back on leaving", () => {
    expect(pointing(event("mouseover", inHeading), HOVER)).toEqual({ light: null, look: { kind: "day", day: "2026-10-26" } });
    expect(pointing(event("mouseover", tab), HOVER).look).toEqual({ kind: "day", day: "2026-10-27" });
    expect(pointing(event("mouseout", inHeading, blank), HOVER).look).toBeNull();
    expect(pointing(event("mouseout", heading, inHeading), HOVER).look).toBeUndefined();
  });

  it("points at nothing when the pointer comes onto anything else, so a highlight can't be left behind", () => {
    // A row removed from under the pointer never says it was left; the next thing the pointer reaches does.
    expect(pointing(event("mouseover", blank), HOVER)).toEqual({ light: null, look: null });
    // Leaving something that points at nothing changes nothing, and nor does focus landing on it.
    expect(pointing(event("mouseout", blank, page), HOVER).look).toBeUndefined();
    expect(pointing(event("focusin", blank), HOVER).look).toBeUndefined();
    expect(pointing(event("focusout", blank), HOVER).look).toBeUndefined();
  });

  it("lights on a touch screen but never moves the map, since its tap sends a mouseover that stays until the next tap", () => {
    expect(pointing(event("mouseover", row), !HOVER)).toEqual({ light: { id: "stop-1", on: true }, look: undefined });
    expect(pointing(event("mouseout", row, blank), !HOVER).look).toBeUndefined();
    expect(pointing(event("mouseover", heading), !HOVER).look).toBeUndefined();
    expect(pointing(event("mouseover", blank), !HOVER).look).toBeUndefined();
  });

  it("follows keyboard focus, but not the focus a click leaves behind", () => {
    const keyed = el("button", {}, row, true);
    const clicked = el("button", {}, row, false);
    expect(pointing(event("focusin", keyed), HOVER)).toEqual({ light: { id: "stop-1", on: true }, look: { kind: "event", id: "stop-1" } });
    expect(pointing(event("focusin", clicked), HOVER)).toEqual({ light: { id: "stop-1", on: true }, look: undefined });
    // Either way, losing focus puts the map back, and moving focus within the row doesn't.
    expect(pointing(event("focusout", keyed, blank), HOVER)).toEqual({ light: { id: "stop-1", on: false }, look: null });
    expect(pointing(event("focusout", clicked, blank), HOVER).look).toBeNull();
    expect(pointing(event("focusout", keyed, clicked), HOVER).look).toBeUndefined();
    const dayTab = el("button", { "data-hl-day": "2026-10-28" }, page, false);
    expect(pointing(event("focusin", dayTab), HOVER).look).toBeUndefined();
    expect(pointing(event("focusin", el("button", { "data-hl-day": "2026-10-28" }, page, true)), HOVER).look).toEqual({ kind: "day", day: "2026-10-28" });
  });

  it("follows keyboard focus on a touch screen too: only the mouseover is ignored there", () => {
    const keyed = el("button", {}, row, true);
    expect(pointing(event("focusin", keyed), !HOVER).look).toEqual({ kind: "event", id: "stop-1" });
  });
});
