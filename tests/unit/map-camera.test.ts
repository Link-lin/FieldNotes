import { describe, expect, it } from "vitest";
import { centerOf, clampView, easeInOutCubic, fitView, H0, sameView, viewAround, viewOnDay, viewOnStop, W0, zoomPath, type Framing, type View } from "@/features/trips/TripPage/MapPanel/DayMap/camera";
import { createCameraDirector, TIMING, type Clock } from "@/features/trips/TripPage/MapPanel/DayMap/camera-director";
import { createMapFocus, type MapFocus } from "@/features/trips/TripPage/MapPanel/map-focus";

const HOME: View = { x: 0, y: 0, w: W0, h: H0 };
const near = (a: View, b: View) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.w).toBeCloseTo(b.w, 6);
  expect(a.h).toBeCloseTo(b.h, 6);
};

describe("views", () => {
  it("keeps the map's shape around any centre", () => {
    const v = viewAround(100, 50, 80);
    expect(v.h).toBeCloseTo((80 * H0) / W0, 9);
    expect(centerOf(v).x).toBeCloseTo(100, 9);
    expect(centerOf(v).y).toBeCloseTo(50, 9);
  });

  it("fits stops that fill the usual margins into the starting view", () => {
    near(fitView([{ x: 76, y: 56 }, { x: 324, y: 284 }]), HOME);
  });

  it("fits any stops with the margin to spare, in the middle, and never narrower than asked", () => {
    const pts = [{ x: 10, y: 20 }, { x: 14, y: 21 }, { x: 12, y: 26 }];
    const v = fitView(pts);
    for (const p of pts) {
      expect(p.x - v.x).toBeGreaterThanOrEqual((56 * v.w) / W0 - 1e-9);
      expect(v.x + v.w - p.x).toBeGreaterThanOrEqual((56 * v.w) / W0 - 1e-9);
      expect(p.y - v.y).toBeGreaterThanOrEqual((56 * v.w) / W0 - 1e-9);
      expect(v.y + v.h - p.y).toBeGreaterThanOrEqual((56 * v.w) / W0 - 1e-9);
    }
    expect(centerOf(v).x).toBeCloseTo(12, 9);
    expect(fitView([{ x: 5, y: 5 }], 30).w).toBe(30);
    expect(fitView(pts, 1000).w).toBe(1000);
  });

  it("holds a view within half a map of the start, and tells equal views apart from different ones", () => {
    expect(clampView({ x: -999, y: 999, w: 100, h: 85 })).toEqual({ x: -200, y: 425, w: 100, h: 85 });
    expect(clampView({ x: 999, y: -999, w: 100, h: 85 })).toEqual({ x: 500, y: -170, w: 100, h: 85 });
    expect(sameView(HOME, { ...HOME, x: 1e-9 })).toBe(true);
    expect(sameView(HOME, { ...HOME, w: 399 })).toBe(false);
    const deep = viewAround(100, 100, 0.8);
    expect(sameView(deep, viewAround(100.00001, 100, 0.8))).toBe(true);
    expect(sameView(deep, viewAround(100.01, 100, 0.8))).toBe(false);
  });

  it("eases in and out, symmetrically, from 0 to 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    // Slow at both ends, quick in the middle.
    expect(easeInOutCubic(0.1)).toBeLessThan(0.02);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.98);
    expect(easeInOutCubic(0.5 + 0.01) - easeInOutCubic(0.5 - 0.01)).toBeGreaterThan(0.05);
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const e = easeInOutCubic(i / 100);
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e + easeInOutCubic(1 - i / 100)).toBeCloseTo(1, 12);
      last = e;
    }
  });
});

describe("the flight between two views", () => {
  const pairs: Array<[string, View, View]> = [
    ["a long pan at one scale", viewAround(40, 60, 10), viewAround(340, 260, 10)],
    ["a zoom in to a place far away", HOME, viewAround(300, 90, 1.5)],
    ["a zoom out from deep inside", viewAround(300, 90, 1.5), HOME],
    ["a plain zoom in on the same centre", HOME, viewAround(200, 170, 20)],
    ["a plain zoom out on the same centre", viewAround(200, 170, 20), HOME],
    ["a small pan at a deep zoom", viewAround(150, 150, 0.9), viewAround(150.2, 150.1, 0.9)],
    ["a huge zoom ratio with a far pan", HOME, viewAround(380, 300, 0.4)],
  ];

  it.each(pairs)("starts where it starts and ends where it ends: %s", (_, from, to) => {
    const path = zoomPath(from, to);
    near(path.at(0), from);
    near(path.at(1), to);
  });

  it.each(pairs)("never leaves the map's shape or produces a bad number: %s", (_, from, to) => {
    const path = zoomPath(from, to);
    for (let i = 0; i <= 200; i++) {
      const v = path.at(i / 200);
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.w) && Number.isFinite(v.h)).toBe(true);
      expect(v.w).toBeGreaterThan(0);
      expect(v.h / v.w).toBeCloseTo(H0 / W0, 9);
    }
  });

  it("moves in small steps, without a jump", () => {
    for (const [, from, to] of pairs) {
      const path = zoomPath(from, to);
      let prev = path.at(0);
      for (let i = 1; i <= 400; i++) {
        const v = path.at(i / 400);
        // A step changes the scale by a fraction of a percent of the total, and the centre by a fraction of the view.
        expect(Math.abs(Math.log(v.w / prev.w))).toBeLessThan(0.06 + Math.abs(Math.log(to.w / from.w)) / 100);
        expect(Math.hypot(centerOf(v).x - centerOf(prev).x, centerOf(v).y - centerOf(prev).y)).toBeLessThan(Math.max(prev.w, v.w) * 0.2 + 1e-9);
        prev = v;
      }
    }
  });

  it("zooms out in the middle of a long pan, so both ends stay in sight, then back in", () => {
    const path = zoomPath(viewAround(40, 60, 10), viewAround(340, 260, 10));
    const middle = path.at(0.5);
    expect(middle.w).toBeGreaterThan(100);
    expect(path.at(0.05).w).toBeLessThan(middle.w);
    expect(path.at(0.95).w).toBeLessThan(middle.w);
  });

  it("is a plain zoom on one centre: the centre stays put and the scale changes steadily", () => {
    const path = zoomPath(HOME, viewAround(200, 170, 20));
    let last = Infinity;
    for (let i = 0; i <= 50; i++) {
      const v = path.at(i / 50);
      expect(centerOf(v).x).toBeCloseTo(200, 6);
      expect(centerOf(v).y).toBeCloseTo(170, 6);
      expect(v.w).toBeLessThanOrEqual(last);
      last = v.w;
    }
  });

  it("is longer the farther it goes, and the more it zooms", () => {
    const near1 = zoomPath(viewAround(100, 100, 10), viewAround(110, 100, 10)).length;
    const far = zoomPath(viewAround(100, 100, 10), viewAround(300, 100, 10)).length;
    expect(far).toBeGreaterThan(near1);
    const mild = zoomPath(HOME, viewAround(200, 170, 100)).length;
    const strong = zoomPath(HOME, viewAround(200, 170, 2)).length;
    expect(strong).toBeGreaterThan(mild);
  });
});

describe("where to look", () => {
  // A trip across an ocean: a stop's neighbourhood is a speck of the starting view.
  const wide: Framing = { home: HOME, span: 1.5, floor: 1.5, pixels: 400 };
  // A trip within one town: a stop's neighbourhood is bigger than the whole view, so it is a share of the view instead.
  const compact: Framing = { home: HOME, span: 990, floor: 33, pixels: 400 };

  it("zooms to a stop's neighbourhood, centred on it", () => {
    const v = viewOnStop({ x: 250, y: 100 }, HOME, wide)!;
    near(v, viewAround(250, 100, 1.5));
  });

  it("zooms a compact trip in to 40% of its starting view, not out to a span it never reaches", () => {
    near(viewOnStop({ x: 250, y: 100 }, HOME, compact)!, viewAround(250, 100, 160));
  });

  it("never goes narrower than the map allows", () => {
    const tight: Framing = { home: HOME, span: 0.1, floor: 1.5, pixels: 400 };
    expect(viewOnStop({ x: 250, y: 100 }, HOME, tight)!.w).toBe(1.5);
  });

  it("zooms in far enough that the stop's marker stands clear of the nearest other place", () => {
    const roomy: Framing = { home: HOME, span: 10, floor: 1, pixels: 400 };
    const at = { x: 100, y: 100 };
    // The nearest other place is 0.3 units away: for it to be 21 px away on a 400 px map the view can be 0.3 × 400 / 21 wide.
    const v = viewOnStop(at, HOME, roomy, [{ x: 100.3, y: 100 }, { x: 160, y: 100 }])!;
    expect(v.w).toBeCloseTo((0.3 * 400) / 21, 9);
    // Another place at the very same spot, or a fraction of the span away, is the same place and doesn't count.
    expect(viewOnStop(at, HOME, roomy, [{ x: 100, y: 100 }, { x: 100.01, y: 100 }])!.w).toBe(10);
    // Never tighter than the map allows, and never wider than a stop's neighbourhood.
    expect(viewOnStop(at, HOME, { ...roomy, floor: 2 }, [{ x: 100.06, y: 100 }])!.w).toBe(2);
    expect(viewOnStop(at, HOME, roomy, [{ x: 160, y: 100 }])!.w).toBe(10);
  });

  it("never zooms out from a view the person had already made tighter", () => {
    const mine = viewAround(100, 100, 0.8);
    const v = viewOnStop({ x: 100.5, y: 100 }, mine, wide)!;
    expect(v.w).toBe(0.8);
    expect(centerOf(v).x).toBeCloseTo(100.5, 9);
  });

  it("stays where it is when the stop is already near the middle of a view that tight", () => {
    const mine = viewAround(100, 100, 1.2);
    expect(viewOnStop({ x: 100.1, y: 100.05 }, mine, wide)).toBeNull();
  });

  it("holds a day's stops, with at least a stop's neighbourhood around them", () => {
    const day = [{ x: 100, y: 100 }, { x: 100.4, y: 100.1 }, { x: 100.2, y: 100.5 }];
    const v = viewOnDay(day, HOME, wide)!;
    for (const p of day) expect(p.x > v.x && p.x < v.x + v.w && p.y > v.y && p.y < v.y + v.h).toBe(true);
    expect(v.w).toBeGreaterThanOrEqual(1.5);
    const tight = viewOnDay([{ x: 100, y: 100 }, { x: 100.01, y: 100 }], HOME, wide)!;
    expect(tight.w).toBe(1.5);
  });

  it("stays put when the view already shows the day and isn't much wider than it", () => {
    const day = [{ x: 100, y: 100 }, { x: 100.4, y: 100.1 }];
    const fit = viewOnDay(day, HOME, wide)!;
    expect(viewOnDay(day, fit, wide)).toBeNull();
    expect(viewOnDay([], HOME, wide)).toBeNull();
  });

  it("zooms out to show a day that the person's own view cuts off", () => {
    const day = [{ x: 100, y: 100 }, { x: 105, y: 102 }];
    const mine = viewAround(100, 100, 1.5);
    const v = viewOnDay(day, mine, wide)!;
    expect(v.w).toBeGreaterThan(mine.w);
  });
});

describe("what the page points the map at", () => {
  it("tells watchers when the focus changes, not when it is set to what it already is", () => {
    const store = createMapFocus();
    const seen: Array<MapFocus | null> = [];
    const off = store.subscribe(() => seen.push(store.get()));
    store.set({ kind: "event", id: "a" });
    store.set({ kind: "event", id: "a" });
    store.set({ kind: "day", day: "2026-10-20" });
    store.set({ kind: "day", day: "2026-10-20" });
    store.set({ kind: "day", day: "2026-10-21" });
    store.set({ kind: "event", id: "2026-10-21" });
    store.set(null);
    store.set(null);
    expect(seen).toEqual([{ kind: "event", id: "a" }, { kind: "day", day: "2026-10-20" }, { kind: "day", day: "2026-10-21" }, { kind: "event", id: "2026-10-21" }, null]);
    off();
    store.set({ kind: "event", id: "b" });
    expect(seen).toHaveLength(5);
    expect(store.get()).toEqual({ kind: "event", id: "b" });
  });
});

describe("the camera director", () => {
  const A = viewAround(100, 100, 10);
  const B = viewAround(200, 120, 10);
  const DAY = viewAround(150, 110, 40);
  const where = (f: MapFocus, rest: View): View | null => (f.kind === "event" ? (f.id === "a" ? A : f.id === "b" ? B : null) : f.day === "d1" ? DAY : rest.w < 0 ? null : null);

  /** A director on a fake clock and a fake frame loop that steps 16 ms at a time. */
  function rig(over: Partial<Parameters<typeof createCameraDirector>[0]> = {}, hooks: { onShow?: (count: number) => void; stubbornFrames?: boolean } = {}) {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const frames = new Map<number, (t: number) => void>();
    const clock: Clock = {
      now: () => now,
      setTimeout: (fn, ms) => {
        timers.set(++seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (id) => void timers.delete(id as number),
      requestFrame: (fn) => {
        frames.set(++seq, fn);
        return seq;
      },
      // A frame already queued can't always be called back; the director has to ignore it itself.
      cancelFrame: (id) => void (hooks.stubbornFrames || frames.delete(id as number)),
    };
    let view = HOME;
    const shown: View[] = [];
    const events: string[] = [];
    const director = createCameraDirector({
      clock,
      view: () => view,
      show: (v) => {
        view = v;
        shown.push(v);
        hooks.onShow?.(shown.length);
      },
      resolve: where,
      instant: () => false,
      visible: () => true,
      previewing: (on) => events.push(on ? "preview" : "rest"),
      ...over,
    });
    const advance = (ms: number) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.fn();
          }
        }
        const due = [...frames];
        frames.clear();
        for (const [, fn] of due) fn(now);
      }
    };
    return { director, advance, shown, events, now: () => now, view: () => view };
  }
  const event = (id: string): MapFocus => ({ kind: "event", id });

  it("flies to what the page highlights after a short pause, and back to where the person was after leaving it", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent - 50);
    expect(r.shown).toHaveLength(0); // resting is what starts it
    r.advance(100);
    expect(r.shown.length).toBeGreaterThan(0);
    r.advance(TIMING.max + 100);
    near(r.view(), A);
    expect(r.events).toEqual(["preview"]);
    r.director.point(null);
    r.advance(TIMING.leave - 50);
    near(r.view(), A); // not yet
    r.advance(100 + TIMING.max + 100);
    near(r.view(), HOME);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("waits a moment before the first flight, and before going back, whatever the timings are set to", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(120);
    expect(r.shown).toHaveLength(0);
    r.advance(TIMING.intent + TIMING.max + 100);
    near(r.view(), A);
    r.director.point(null);
    r.advance(150);
    near(r.view(), A);
  });

  it("ignores a pointer passing over: leaving before the pause is up moves nothing", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent - 60);
    r.director.point(null);
    r.advance(3000);
    expect(r.shown).toHaveLength(0);
    expect(r.events).toEqual([]);
  });

  it("goes from one thing to the next without returning in between, and back only after the last", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + TIMING.max + 100);
    near(r.view(), A);
    r.director.point(null);
    r.advance(TIMING.leave - 100); // the pointer is already on the next row
    r.director.point(event("b"));
    const before = r.shown.length;
    r.advance(160); // moving on while looking at something takes less of a pause than the first look did
    expect(r.shown.length).toBeGreaterThan(before);
    r.advance(TIMING.retarget + TIMING.max + 100);
    near(r.view(), B);
    expect(r.events).toEqual(["preview"]); // never back at rest in between
    r.director.point(null);
    r.advance(TIMING.leave + TIMING.max + 100);
    near(r.view(), HOME);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("changes course in the middle of a flight from where the camera is, with no jump", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + 300);
    expect(r.view().w).toBeLessThan(HOME.w);
    expect(r.view().w).toBeGreaterThan(A.w);
    r.director.point(event("b"));
    r.advance(TIMING.retarget + TIMING.max + 100);
    near(r.view(), B);
    // No step, across the change of course, is anywhere near a jump back to the start view or across to B (a jump would
    // change the scale by a factor of tens in one frame, or move the centre by more than a view's width).
    for (let i = 1; i < r.shown.length; i++) {
      const [a, b] = [r.shown[i - 1]!, r.shown[i]!];
      expect(Math.abs(Math.log(b.w / a.w))).toBeLessThan(0.35);
      expect(Math.hypot(centerOf(b).x - centerOf(a).x, centerOf(b).y - centerOf(a).y)).toBeLessThan(Math.max(a.w, b.w) * 0.5);
    }
  });

  it("flies a day's view the same way, and a return from it", () => {
    const r = rig();
    r.director.point({ kind: "day", day: "d1" });
    r.advance(TIMING.intent + TIMING.max + 100);
    near(r.view(), DAY);
    r.director.point(null);
    r.advance(TIMING.leave + TIMING.max + 100);
    near(r.view(), HOME);
  });

  it("stops when the person uses the map, and doesn't go back", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + 300);
    r.director.takeOver();
    const stopped = r.shown.length;
    const where = r.view();
    r.advance(3000);
    expect(r.shown).toHaveLength(stopped);
    r.director.point(null);
    r.advance(3000);
    expect(r.shown).toHaveLength(stopped);
    expect(r.view()).toBe(where);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("stops a flight when the person takes over while a frame is being shown", () => {
    const holder: { director?: ReturnType<typeof createCameraDirector> } = {};
    const r = rig({}, { onShow: (count) => count === 5 && holder.director!.takeOver() });
    holder.director = r.director;
    r.director.point(event("a"));
    r.advance(TIMING.intent + TIMING.max + 200);
    expect(r.shown).toHaveLength(5);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("ignores a frame it could not cancel", () => {
    const r = rig({}, { stubbornFrames: true });
    r.director.point(event("a"));
    r.advance(TIMING.intent + 300);
    r.director.takeOver();
    const stopped = r.shown.length;
    r.advance(2000);
    expect(r.shown).toHaveLength(stopped);
  });

  it("keeps what it shows when the pointer reaches the map before the highlight is let go", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + TIMING.max + 100);
    r.director.point(null);
    r.advance(100);
    r.director.keep();
    r.advance(5000);
    near(r.view(), A);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("lets a flight that is already under way finish when the pointer reaches the map", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + 200);
    r.director.point(null);
    r.director.keep();
    r.advance(TIMING.max + 100);
    near(r.view(), A);
  });

  it("leaves a map that is out of sight where it is", () => {
    const r = rig({ visible: () => false });
    r.director.point(event("a"));
    r.advance(3000);
    expect(r.shown).toHaveLength(0);
    expect(r.events).toEqual([]);
  });

  it("goes back when what the page highlights has nowhere to look at", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + TIMING.max + 100);
    r.director.point(event("nowhere")); // an event with no pin
    r.advance(TIMING.retarget + TIMING.leave + TIMING.max + 200);
    near(r.view(), HOME);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("does nothing for something it has nowhere to look at when nothing was shown", () => {
    const r = rig();
    r.director.point(event("nowhere"));
    r.advance(3000);
    expect(r.shown).toHaveLength(0);
    expect(r.events).toEqual([]);
  });

  it("jumps instead of flying for reduced motion, and back the same way", () => {
    const r = rig({ instant: () => true });
    r.director.point(event("a"));
    r.advance(TIMING.intent + 50);
    expect(r.shown).toEqual([A]);
    r.director.point(null);
    r.advance(TIMING.leave + 50);
    expect(r.shown).toEqual([A, HOME]);
    expect(r.events).toEqual(["preview", "rest"]);
  });

  it("keeps a flight within its limits, however far it goes", () => {
    const short = rig();
    short.director.point(event("a"));
    short.advance(TIMING.intent);
    const start = short.now();
    short.advance(TIMING.max + 100);
    expect(short.shown.length).toBeGreaterThan(TIMING.min / 20);
    expect(short.shown.length).toBeLessThan((TIMING.max + 100) / 8);
    near(short.view(), A);
    expect(short.now() - start).toBeGreaterThan(TIMING.min);
  });

  it("stops everything when it is disposed", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + 200);
    r.director.dispose();
    const stopped = r.shown.length;
    r.advance(3000);
    expect(r.shown).toHaveLength(stopped);
  });

  it("frames each flight at a steady rate: no frame is skipped or repeated", () => {
    const r = rig();
    r.director.point(event("a"));
    r.advance(TIMING.intent + TIMING.max + 100);
    // 16 ms per frame: the number of frames matches the flight's length, and no two are identical until the last.
    const keys = r.shown.map((v) => `${v.x}|${v.y}|${v.w}`);
    const distinct = new Set(keys).size;
    expect(distinct).toBeGreaterThanOrEqual(keys.length - 2);
  });
});
