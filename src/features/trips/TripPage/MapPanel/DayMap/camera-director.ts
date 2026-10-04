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
  /** The pointer reached the map: whatever it shows now stays. */
  keep: () => void;
  dispose: () => void;
};

/**
 * Moves the map to what the page highlights, and back when the highlight ends, with a smooth flight each way. Resting
 * on something starts it; moving on to the next thing retargets from where the camera is; leaving everything returns it to
 * the view the person had. Using the map takes over for good (`takeOver`), and so does moving the pointer onto it (`keep`).
 */
export function createCameraDirector(o: Options): CameraDirector {
  const t = { ...TIMING, ...o.timing };
  let rest: View | null = null;
  let timer: unknown = null;
  let frame: unknown = null;
  let flight = 0;

  const clearTimer = () => {
    if (timer !== null) o.clock.clearTimeout(timer);
    timer = null;
  };
  const stopFlight = () => {
    flight += 1;
    if (frame !== null) o.clock.cancelFrame(frame);
    frame = null;
  };
  const remember = (view: View | null) => {
    const was = rest !== null;
    rest = view;
    if ((view !== null) !== was) o.previewing?.(view !== null);
  };
  const later = (ms: number, fn: () => void) => {
    clearTimer();
    timer = o.clock.setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };

  function fly(to: View, arrived?: () => void) {
    stopFlight();
    const from = o.view();
    if (o.instant() || sameView(from, to)) {
      o.show(to);
      arrived?.();
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
        arrived?.();
      }
    };
    frame = o.clock.requestFrame(step);
  }

  function back() {
    const home = rest;
    if (home) fly(home, () => remember(null));
  }

  function go(focus: MapFocus) {
    if (!o.visible()) return;
    const from = rest ?? o.view();
    const to = o.resolve(focus, from);
    if (!to) {
      if (rest) later(t.leave, back);
      return;
    }
    if (!rest) remember(from);
    fly(to);
  }

  return {
    point(focus) {
      if (focus) later(rest ? t.retarget : t.intent, () => go(focus));
      else if (rest) later(t.leave, back);
      else clearTimer();
    },
    takeOver() {
      clearTimer();
      stopFlight();
      remember(null);
    },
    keep() {
      clearTimer();
      remember(null);
    },
    dispose() {
      clearTimer();
      stopFlight();
    },
  };
}
