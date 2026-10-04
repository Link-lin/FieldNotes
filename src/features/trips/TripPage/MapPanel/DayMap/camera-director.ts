import type { MapFocus } from "../map-focus";
import { easeInOutCubic, sameView, zoomPath, type View } from "./camera";

/** The browser's clock and frame loop, passed in so the director can be tested with a fake one. */
export type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  requestFrame: (fn: (now: number) => void) => unknown;
  cancelFrame: (id: unknown) => void;
};

/** How long the camera waits, and how long a flight takes, in milliseconds. */
export const TIMING = {
  /** Resting on something this long starts the first flight, so a pointer passing over rows doesn't. */
  intent: 200,
  /** Moving between things while the map is already looking at one, which should feel quick. */
  retarget: 120,
  /** Leaving everything this long sends the map back; moving to the next row before then doesn't. */
  leave: 320,
  /** A flight lasts base + perLength × how far it goes, between min and max. */
  base: 420,
  perLength: 190,
  min: 450,
  max: 1000,
};

type Options = {
  clock: Clock;
  /** The view on screen now. */
  view: () => View;
  /** Shows one frame of a flight. */
  show: (view: View) => void;
  /** Where to look for a highlight, given the view to return to; null when there is nowhere to go. */
  resolve: (focus: MapFocus, rest: View) => View | null;
  /** Reduced motion: jump instead of flying. */
  instant: () => boolean;
  /** Whether the map is on screen; one out of sight stays where it is. */
  visible: () => boolean;
  /** The map is showing a highlight (true), or is back where the person left it (false). */
  previewing?: (on: boolean) => void;
  timing?: Partial<typeof TIMING>;
};

export type CameraDirector = {
  /** The page is pointing at this (or at nothing). */
  point: (focus: MapFocus | null) => void;
  /** The person is using the map themselves: stop, and don't go back. */
  takeOver: () => void;
  /** The pointer is on the map: what it shows stays while the pointer does. */
  hold: () => void;
  /** The pointer left the map: what it was showing for a highlight goes back, after the usual pause. */
  release: () => void;
  dispose: () => void;
};

/**
 * Moves the map to what the page highlights, and back when the highlight ends, with a smooth flight each way. Resting
 * on something starts it; moving on to the next thing retargets from where the camera is; leaving everything returns it to
 * the view the person had, all the way. The pointer going onto the map to look at what it shows holds the view while it
 * stays there (`hold`) and sends it back once it leaves (`release`). Using the map takes over for good (`takeOver`).
 */
export function createCameraDirector(o: Options): CameraDirector {
  const t = { ...TIMING, ...o.timing };
  let rest: View | null = null;
  let timer: unknown = null;
  let waiting: "go" | "back" | null = null;
  let frame: unknown = null;
  let flight = 0;
  let returning = false;
  let held = false;
  let pointed: MapFocus | null = null;

  const clearTimer = () => {
    if (timer !== null) o.clock.clearTimeout(timer);
    timer = null;
    waiting = null;
  };
  const stopFlight = () => {
    flight += 1;
    returning = false;
    if (frame !== null) o.clock.cancelFrame(frame);
    frame = null;
  };
  const remember = (view: View | null) => {
    const was = rest !== null;
    rest = view;
    if ((view !== null) !== was) o.previewing?.(view !== null);
  };
  const later = (ms: number, kind: "go" | "back", fn: () => void) => {
    clearTimer();
    waiting = kind;
    timer = o.clock.setTimeout(() => {
      timer = null;
      waiting = null;
      fn();
    }, ms);
  };
  /** Whether a highlight that has ended should send the map back now: not while the pointer is on it or it is already going. */
  const returnsNow = () => rest !== null && !held && !returning;

  function fly(to: View, home = false) {
    stopFlight();
    returning = home;
    const arrived = () => {
      returning = false;
      if (home) remember(null);
    };
    const from = o.view();
    if (o.instant() || sameView(from, to)) {
      o.show(to);
      arrived();
      return;
    }
    const path = zoomPath(from, to);
    const ms = Math.min(t.max, Math.max(t.min, t.base + t.perLength * path.length));
    const id = flight;
    let start: number | null = null;
    const step = (now: number) => {
      if (id !== flight) return;
      start ??= now;
      const p = Math.min(1, (now - start) / ms);
      o.show(p >= 1 ? to : path.at(easeInOutCubic(p)));
      if (id !== flight) return; // the person took over, or another flight began, while this frame was shown
      if (p < 1) {
        frame = o.clock.requestFrame(step);
      } else {
        frame = null;
        arrived();
      }
    };
    frame = o.clock.requestFrame(step);
  }

  function back() {
    if (rest) fly(rest, true);
  }

  function go(focus: MapFocus) {
    if (!o.visible()) return;
    const from = rest ?? o.view();
    const to = o.resolve(focus, from);
    if (!to) {
      if (returnsNow()) later(t.leave, "back", back);
      return;
    }
    if (!rest) remember(from);
    fly(to);
  }

  return {
    point(focus) {
      pointed = focus;
      if (focus) later(rest ? t.retarget : t.intent, "go", () => go(focus));
      else if (returnsNow()) later(t.leave, "back", back);
      else if (waiting === "go") clearTimer();
    },
    takeOver() {
      clearTimer();
      stopFlight();
      remember(null);
    },
    hold() {
      held = true;
      if (waiting === "back") clearTimer();
    },
    release() {
      held = false;
      if (!pointed && returnsNow()) later(t.leave, "back", back);
    },
    dispose() {
      clearTimer();
      stopFlight();
    },
  };
}
