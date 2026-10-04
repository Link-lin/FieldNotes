/**
 * The outline map's camera: views, smooth flights between them, and where to look for a highlighted stop or
 * day. Pure functions, so the motion can be tested without a browser.
 */

/** The map's own coordinate space: the view box it starts from. */
export const W0 = 400;
export const H0 = 340;
/** Margin kept around the stops when fitting them, in map units (the fit also leaves 40 more on the right for labels). */
export const PAD = 56;

/** The part of the map on screen, as an SVG view box. */
export type View = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export const centerOf = (v: View): Point => ({ x: v.x + v.w / 2, y: v.y + v.h / 2 });

/** The view `w` wide (the height follows the map's shape) with `cx`, `cy` at its middle. */
export function viewAround(cx: number, cy: number, w: number): View {
  const h = (w * H0) / W0;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** A view may pan half a map beyond the start view, and no further. */
export function clampView(v: View): View {
  return { ...v, x: Math.max(-W0 * 0.5, Math.min(W0 * 1.5 - v.w, v.x)), y: Math.max(-H0 * 0.5, Math.min(H0 * 1.5 - v.h, v.y)) };
}

/** Whether two views look the same, to well under a pixel at any zoom. */
export function sameView(a: View, b: View): boolean {
  const eps = Math.min(a.w, b.w) * 1e-4;
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps;
}

/** The view that holds every point with the map's usual margins (the fit it starts from), at least `minW` wide. */
export function fitView(points: readonly Point[], minW = 0): View {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(minW, ((x1 - x0) * W0) / (W0 - 2 * PAD - 40), ((y1 - y0) * W0) / (H0 - 2 * PAD));
  return viewAround((x0 + x1) / 2, (y0 + y1) / 2, w);
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const RHO = Math.SQRT2;
const cosh = (x: number) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x: number) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};

/**
 * A flight from one view to another that keeps its bearings: van Wijk and Nuij's "Smooth and efficient zooming and
 * panning". Over a long way it zooms out a little and back in rather than sliding across the map at one scale, and
 * the picture moves at a steady rate. `at(t)` gives the view for t from 0 to 1 (ease it for the feel); `length` is
 * how far the camera travels, pan and zoom together, for choosing a duration.
 */
export function zoomPath(from: View, to: View): { length: number; at: (t: number) => View } {
  const a = centerOf(from);
  const b = centerOf(to);
  const w0 = from.w;
  const w1 = to.w;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  // The same place at another scale: a plain zoom.
  if (d < Math.min(w0, w1) * 1e-6) {
    const s = Math.log(w1 / w0) / RHO;
    return { length: Math.abs(s), at: (t) => viewAround(a.x + t * dx, a.y + t * dy, w0 * Math.exp(RHO * t * s)) };
  }
  const rho2 = RHO * RHO;
  const rho4 = rho2 * rho2;
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d * d) / (2 * w0 * rho2 * d);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d * d) / (2 * w1 * rho2 * d);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const s = (r1 - r0) / RHO;
  const coshR0 = cosh(r0);
  return {
    length: Math.abs(s),
    at(t) {
      const m = RHO * t * s + r0;
      const u = (w0 / (rho2 * d)) * (coshR0 * tanh(m) - sinh(r0));
      return viewAround(a.x + u * dx, a.y + u * dy, (w0 * coshR0) / cosh(m));
    },
  };
}

/** What the camera needs to know about the map to choose where to look. */
export type Framing = {
  /** The view the map starts from, fitting every stop. */
  home: View;
  /** How wide a view to give one stop, in map units (a few kilometres across). */
  span: number;
  /** The narrowest view the map allows. */
  floor: number;
  /** How wide the map is on screen, in pixels. */
  pixels: number;
};

/** Pins closer than this many pixels merge into one marker (see DayMap); a stop is shown clear of its neighbours at half as far again. */
const MERGE_PX = 14;
const CLEAR_PX = MERGE_PX * 1.5;
/** Places within this share of `span` of each other are one place (a venue visited twice), which no zoom pulls apart. */
const SAME_PLACE = 0.005;

/** One stop's neighbourhood: at most `span` wide and a good deal tighter than the start view when that is already small. */
const stopWidth = (f: Framing): number => Math.max(f.floor, Math.min(f.span, f.home.w * 0.4));

/** The widest view in which `at` is still clear of the nearest other place (infinitely wide when there is none). */
function clearWidth(at: Point, others: readonly Point[], f: Framing): number {
  let nearest = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.x - at.x, o.y - at.y);
    if (d > f.span * SAME_PLACE && d < nearest) nearest = d;
  }
  return (nearest * f.pixels) / CLEAR_PX;
}

/**
 * Where to look to show one stop: centred on it and zoomed in to its neighbourhood, close enough that its marker stands
 * apart from the places around it where the map allows, but never zoomed out from the view the person had (`rest`) if
 * that was already tighter. null when that view already shows it near its middle.
 */
export function viewOnStop(at: Point, rest: View, f: Framing, others: readonly Point[] = []): View | null {
  const want = Math.max(f.floor, Math.min(stopWidth(f), clearWidth(at, others, f)));
  const c = centerOf(rest);
  const calm = rest.w <= want * 1.05 && Math.abs(at.x - c.x) < rest.w * 0.25 && Math.abs(at.y - c.y) < rest.h * 0.25;
  return calm ? null : viewAround(at.x, at.y, Math.min(want, rest.w));
}

/**
 * Where to look to show a day: the view that holds its stops, at least a stop's neighbourhood wide. null when the view the
 * person had (`rest`) already holds them and isn't much wider than that.
 */
export function viewOnDay(points: readonly Point[], rest: View, f: Framing): View | null {
  if (!points.length) return null;
  const fit = fitView(points, stopWidth(f));
  const holds = points.every((p) => p.x > rest.x && p.x < rest.x + rest.w && p.y > rest.y && p.y < rest.y + rest.h);
  return holds && fit.w >= rest.w * 0.8 ? null : fit;
}
