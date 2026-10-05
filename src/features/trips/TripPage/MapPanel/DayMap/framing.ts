import { haversineKm } from "@/shared/map-links";

/*
 * Where the outline map looks first (MAP-3), as pure functions. It frames the stops where the trip happens rather than
 * every pin: a flight's far-off arrival airport (home, at the end of the trip) or one stop on another continent would
 * otherwise shrink everything else into one marker. Those get a pointer at the map's edge instead. The view is never so
 * tight that it shows nothing but pins: at least a few kilometres across, and wide enough for the nearest town.
 */

export type FramedStop = { lat: number; lon: number; flight: boolean };

/** A stop this far from the middle of the others (and well beyond their spread) is pointed at, not framed. */
export const FAR_KM = 2500;
/** ... "well beyond": this many times as far as most of the others (the 80th percentile) are from the middle. */
const SPREAD = 6;
/** A flight's arrival this close to a stop on the ground is part of the journey (land, then drive on), so it is framed too. */
export const FLIGHT_NEAR_KM = 300;
/** Stops closer than this are one place (a venue, a hotel), whatever their pins say. */
const ONE_PLACE_KM = 0.15;
/** How far apart, in pixels of a map about as wide as its view box, framed places should stay when the view widens for context. */
const APART_PX = 24;
/** The view the map starts from is at least this wide, so one stop or a short walk still shows land and stops apart. */
export const HOME_MIN_KM = 8;
/** It widens up to this to bring the nearest town into view when none is in it. */
export const CONTEXT_MAX_KM = 40;
/** A town counts as in view inside this share of the view's half-width and half-height. */
const INSIDE = 0.8;

const KM_PER_DEGREE = 111.32;
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** Nearest-rank percentile. */
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]!;

const kmBetween = (a: FramedStop, b: FramedStop) => haversineKm([a.lat, a.lon], [b.lat, b.lon]);

/**
 * The stops the start view fits (indices into `stops`): the stops on the ground, less any far beyond where the rest are,
 * plus the flight arrivals near them. A flight arriving far from all of them (home, at the end of the trip) is left out.
 * With nothing pinned on the ground, the flights are framed.
 */
export function framedStops(stops: readonly FramedStop[]): number[] {
  const all = stops.map((_, i) => i);
  const ground = all.filter((i) => !stops[i]!.flight);
  if (!ground.length) return all;
  let core = ground;
  if (ground.length >= 3) {
    const lat = median(ground.map((i) => stops[i]!.lat));
    const lons = ground.map((i) => stops[i]!.lon);
    const lon0 = lons[0]!;
    const lon = median(lons.map((l) => (l - lon0 > 180 ? l - 360 : l - lon0 < -180 ? l + 360 : l)));
    const far = ground.map((i) => haversineKm([lat, lon], [stops[i]!.lat, stops[i]!.lon]));
    const limit = Math.max(SPREAD * percentile(far, 0.8), FAR_KM);
    core = ground.filter((_, k) => far[k]! <= limit);
  }
  const landings = all.filter((i) => stops[i]!.flight && core.some((j) => kmBetween(stops[i]!, stops[j]!) <= FLIGHT_NEAR_KM));
  return [...core, ...landings].sort((a, b) => a - b);
}

/** The shortest distance between two framed stops that are different places, or Infinity when they are all one place. */
export function closestPlacesKm(stops: readonly FramedStop[], core: readonly number[]): number {
  let best = Infinity;
  for (let a = 0; a < core.length; a++) {
    for (let b = a + 1; b < core.length; b++) {
      const d = kmBetween(stops[core[a]!]!, stops[core[b]!]!);
      if (d > ONE_PLACE_KM && d < best) best = d;
    }
  }
  return best;
}

/** The local projection: longitudes unwrapped around `medianLon`, then x = lon · kx and y = −lat, in degrees. */
export type Projection = { medianLon: number; kx: number };

export function projectionFor(stops: readonly FramedStop[], core: readonly number[]): Projection {
  const pick = core.length ? core : stops.map((_, i) => i);
  const lat0 = pick.reduce((a, i) => a + stops[i]!.lat, 0) / (pick.length || 1);
  const lons = pick.map((i) => stops[i]!.lon).sort((a, b) => a - b);
  return { medianLon: lons[Math.floor(lons.length / 2)] ?? 0, kx: Math.cos((lat0 * Math.PI) / 180) };
}

export function project(p: Projection, lon: number, lat: number): { x: number; y: number } {
  const d = lon - p.medianLon;
  return { x: (d > 180 ? lon - 360 : d < -180 ? lon + 360 : lon) * p.kx, y: -lat };
}

/**
 * The start view, in projected degrees: its middle, and the spans the map's fit is given (the fit keeps its margins
 * around them). `inner` is how much of the map's width and height the fit fills; `aspect` is height over width.
 * `closestKm` is the shortest distance between two framed places (`closestPlacesKm`): widening for a town never brings
 * them closer than `APART_PX` on the map, and one place alone with no town near widens to show the land around it.
 */
export function homeSpans(
  points: ReadonlyArray<{ x: number; y: number }>,
  towns: ReadonlyArray<{ x: number; y: number }>,
  map: { width: number; innerX: number; innerY: number; aspect: number },
  closestKm = Infinity,
): { cx: number; cy: number; spanX: number; spanY: number } {
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  // The width the fit gives the view, in degrees, for a span across.
  const widthOf = (sx: number) => Math.max((sx * map.width) / map.innerX, (spanY * map.width) / map.innerY);
  const spanFor = (width: number) => (width * map.innerX) / map.width;
  const minimum = HOME_MIN_KM / KM_PER_DEGREE;
  if (widthOf(spanX) < minimum) spanX = spanFor(minimum);
  const width = widthOf(spanX);
  // As wide as context may take it: the limit, and no wider than keeps the closest framed places apart.
  const ceiling = Math.min(CONTEXT_MAX_KM, (closestKm * map.width) / APART_PX) / KM_PER_DEGREE;
  if (width < ceiling) {
    const halfW = width / 2;
    const halfH = halfW * map.aspect;
    const inView = towns.some((t) => Math.abs(t.x - cx) <= INSIDE * halfW && Math.abs(t.y - cy) <= INSIDE * halfH);
    if (!inView) {
      // The narrowest view around the same middle that would hold a town.
      let need = Infinity;
      for (const t of towns) need = Math.min(need, (2 * Math.max(Math.abs(t.x - cx), Math.abs(t.y - cy) / map.aspect)) / INSIDE);
      if (need <= ceiling) spanX = spanFor(need);
      else if (closestKm === Infinity) spanX = spanFor(ceiling);
    }
  }
  return { cx, cy, spanX, spanY };
}

/** The most prominent city labels (Natural Earth rank, 0 the most) worth drawing on a view this many kilometres across. */
export function cityRankLimit(viewKm: number): number {
  if (viewKm <= 80) return 7;
  if (viewKm <= 250) return 6;
  if (viewKm <= 800) return 5;
  if (viewKm <= 2500) return 4;
  if (viewKm <= 7000) return 3;
  return 2;
}

export type EdgePointer = { members: number[]; x: number; y: number; angle: number };

/**
 * Where to point at stops beyond the map: on the map's edge (inset by `inset` pixels), along the line from its middle,
 * with pointers closer than `gap` pixels to each other merged. Screen coordinates in, screen coordinates out; `angle` in
 * degrees, 0 to the right and clockwise.
 */
export function edgePointers(far: ReadonlyArray<{ index: number; x: number; y: number }>, width: number, height: number, inset = 24, gap = 44): EdgePointer[] {
  const cx = width / 2;
  const cy = height / 2;
  const placed = far.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const tx = dx > 0 ? (width - inset - cx) / dx : dx < 0 ? (inset - cx) / dx : Infinity;
    const ty = dy > 0 ? (height - inset - cy) / dy : dy < 0 ? (inset - cy) / dy : Infinity;
    const t = Math.min(tx, ty, 1);
    return { index: p.index, x: cx + t * dx, y: cy + t * dy, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }).sort((a, b) => a.angle - b.angle);
  const out: EdgePointer[] = [];
  for (const p of placed) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < gap) last.members.push(p.index);
    else out.push({ members: [p.index], x: p.x, y: p.y, angle: p.angle });
  }
  // The first and last can meet across the cut at ±180 degrees.
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y) < gap) {
      first.members.push(...last.members);
      out.pop();
    }
  }
  return out;
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
/** "east", "north-west" and so on, for a screen angle (0 to the right, clockwise, as `edgePointers` gives it). */
export const compass = (angle: number): string => COMPASS[((Math.round(angle / 45) % 8) + 8) % 8]!;
