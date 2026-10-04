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
  /** Moving between things while the camera is already looking at one, which should feel quick. */
  retarget: 120,
  /** Leaving everything this long eases the map out a little; moving to the next row before then doesn't. */
  leave: 320,
  /** A flight lasts base + perLength × how far it goes, between min and max. */
  base: 420,
  perLength: 190,
  min: 450,
  max: 1000,
};

/** What `resolve` answers when the stop or day is already well framed by the view the camera has. */
export const FRAMED = "framed";

type Options = {
  clock: Clock;
  /** The view on screen now. */
  view: () => View;
  /** Shows one frame of a flight. */
  show: (view: View) => void;
  /**
   * Where to look for a highlight, given the view the camera has (or is flying to): a view to fly to, FRAMED when that
   * view already shows it, or null when there is nothing to look at (a stop with no pin).
   */
  resolve: (focus: MapFocus, now: View) => View | typeof FRAMED | null;
  /** Where to ease out to once a highlight has ended, from the view it showed. */
  relax: (shown: View) => View;
  /** Reduced motion: jump instead of flying. */
  instant: () => boolean;
  /** Whether the map is on screen; one out of sight stays where it is. */
  visible: () => boolean;
  timing?: Partial<typeof TIMING>;
};

export type CameraDirector = {
  /** The page is pointing at this (or at nothing). */
  point: (focus: MapFocus | null) => void;
  /** The person is using the map themselves: stop, and leave the view as it is. */
  takeOver: () => void;
  /** The pointer is on the map: what it shows stays while the pointer does. */
  hold: () => void;
  /** The pointer left the map: what it showed for a highlight eases out, after the usual pause. */
  release: () => void;
  /** Fly to this view at the person's request (Reset view); nothing eases out afterwards. */
  glide: (view: View) => void;
  dispose: () => void;
};

/**
 * Moves the map to what the page highlights, with a smooth flight. Resting on something starts it; moving on to the next
 * thing flies on from where the camera is, with no step back in between, however far away it is. When everything has been
 * left the map eases out a little around where it was and stays there: it doesn't go back to the whole trip on its own
 * (Reset view does, by `glide`). The pointer going onto the map to look at what it shows holds the view while it stays there
 * (`hold`) and the easing out happens once it leaves (`release`). Using the map takes over for good (`takeOver`).
 */
export function createCameraDirector(o: Options): CameraDirector {
  const t = { ...TIMING, ...o.timing };
  /** The camera, not the person, set the view: a highlight has moved it since they last used the map. */
  let ours = false;
  /** Where the flight under way is heading, so that what comes next starts from there. */
  let aim: View | null = null;
  let timer: unknown = null;
  let waiting: "go" | "relax" | null = null;
  let frame: unknown = null;
  let flight = 0;
  let easing = false;
  let held = false;
  let pointed: MapFocus | null = null;

  const clearTimer = () => {
    if (timer !== null) o.clock.clearTimeout(timer);
    timer = null;
    waiting = null;
  };
  const stopFlight = () => {
    flight += 1;
    easing = false;
    aim = null;
    if (frame !== null) o.clock.cancelFrame(frame);
    frame = null;
  };
  const later = (ms: number, kind: "go" | "relax", fn: () => void) => {
    clearTimer();
    waiting = kind;
    timer = o.clock.setTimeout(() => {
      timer = null;
      waiting = null;
      fn();
    }, ms);
  };
  /** Whether a highlight that has ended should ease the map out now: not while the pointer is on it or it is already easing. */
  const relaxes = () => ours && !held && !easing;

  function fly(to: View, kind: "go" | "relax" | "glide") {
    stopFlight();
    aim = to;
    easing = kind === "relax";
    ours = kind !== "glide";
    const arrived = () => {
      aim = null;
      easing = false;
      if (kind === "relax") ours = false;
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

  function relax() {
    if (ours) fly(o.relax(aim ?? o.view()), "relax");
  }

  function go(focus: MapFocus) {
    if (!o.visible()) return;
    const to = o.resolve(focus, aim ?? o.view());
    if (to === FRAMED) return;
    if (to === null) {
      if (relaxes()) later(t.leave, "relax", relax);
      return;
    }
    fly(to, "go");
  }

  return {
    point(focus) {
      pointed = focus;
      if (focus) later(ours ? t.retarget : t.intent, "go", () => go(focus));
      else if (relaxes()) later(t.leave, "relax", relax);
      else if (waiting === "go") clearTimer();
    },
    takeOver() {
      clearTimer();
      stopFlight();
      ours = false;
    },
    hold() {
      held = true;
      if (waiting === "relax") clearTimer();
    },
    release() {
      held = false;
      if (!pointed && relaxes()) later(t.leave, "relax", relax);
    },
    glide(view) {
      clearTimer();
      fly(view, "glide");
    },
    dispose() {
      clearTimer();
      stopFlight();
    },
  };
}
