import { describe, expect, it } from "vitest";
import { cityRankLimit, closestPlacesKm, compass, CONTEXT_MAX_KM, edgePointers, framedStops, HOME_MIN_KM, homeSpans, project, projectionFor, type FramedStop } from "@/features/trips/TripPage/MapPanel/DayMap/framing";

const at = (lat: number, lon: number, flight = false): FramedStop => ({ lat, lon, flight });
/** n stops scattered within about `km` of a point. */
const around = (lat: number, lon: number, n: number, km = 6): FramedStop[] =>
  Array.from({ length: n }, (_, i) => at(lat + ((i % 3) - 1) * (km / 111.32) * 0.5, lon + ((Math.floor(i / 3) % 3) - 1) * (km / 111.32) * 0.5));

const TOKYO = [35.68, 139.76] as const;
const SFO = [37.62, -122.38] as const;
const KYOTO = [35.01, 135.77] as const;
const HONOLULU = [21.31, -157.86] as const;
const KONA_AIRPORT = [19.7388, -156.0456] as const;
const KILAUEA = [19.4194, -155.2885] as const;

const MAP = { width: 400, innerX: 400 - 2 * 56 - 40, innerY: 340 - 2 * 56, aspect: 340 / 400 };
const widthKm = (s: { spanX: number; spanY: number }) => Math.max((s.spanX * MAP.width) / MAP.innerX, (s.spanY * MAP.width) / MAP.innerY) * 111.32;

describe("which stops the outline map frames (MAP-3)", () => {
  it("leaves out a flight home across an ocean when the trip has stops on the ground", () => {
    const stops = [...around(...TOKYO, 10), at(...SFO, true)];
    expect(framedStops(stops)).toEqual(stops.slice(0, 10).map((_, i) => i));
  });

  it("leaves out one stop on the ground far beyond the rest, such as a hotel by the home airport", () => {
    const stops = [...around(...TOKYO, 10), at(...SFO)];
    expect(framedStops(stops)).not.toContain(10);
    expect(framedStops(stops)).toHaveLength(10);
  });

  it("keeps a trip with two real destinations whole, however far apart, and a day trip a few hundred kilometres away", () => {
    expect(framedStops([...around(...TOKYO, 5), ...around(...HONOLULU, 5)])).toHaveLength(10);
    expect(framedStops([...around(...TOKYO, 15), ...around(...KYOTO, 3)])).toHaveLength(18);
  });

  it("frames a flight's arrival near the day's other stops: landing, then driving on", () => {
    const day = [at(...KONA_AIRPORT, true), at(...KILAUEA)];
    expect(framedStops(day)).toEqual([0, 1]);
    // ...but not one arriving far from all of them.
    expect(framedStops([at(...KILAUEA), at(...SFO, true)])).toEqual([0]);
  });

  it("frames flights when nothing else is pinned, and keeps two lone stops together", () => {
    expect(framedStops([at(...HONOLULU, true), at(...SFO, true)])).toEqual([0, 1]);
    expect(framedStops([at(...TOKYO), at(...SFO)])).toEqual([0, 1]);
    expect(framedStops([])).toEqual([]);
  });

  it("treats stops on either side of the antimeridian as neighbours", () => {
    const fiji = [at(-16.8, 179.9), at(-16.9, -179.9), at(-17.0, 179.8), at(-16.7, -179.8)];
    expect(framedStops(fiji)).toHaveLength(4);
    const p = projectionFor(fiji, [0, 1, 2, 3]);
    const xs = fiji.map((s) => project(p, s.lon, s.lat).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
  });

  it("projects around the framed stops: their latitude sets the east-west scale", () => {
    const stops = [...around(...TOKYO, 6), at(...SFO, true)];
    const p = projectionFor(stops, framedStops(stops));
    expect(p.kx).toBeCloseTo(Math.cos((TOKYO[0] * Math.PI) / 180), 2);
    expect(p.medianLon).toBeCloseTo(TOKYO[1], 0);
  });
});

describe("how wide the map starts", () => {
  const proj = { medianLon: TOKYO[1], kx: Math.cos((TOKYO[0] * Math.PI) / 180) };
  const pt = (lat: number, lon: number) => project(proj, lon, lat);

  it("is never narrower than a few kilometres, so one stop or a short walk shows land and stops apart", () => {
    const spans = homeSpans([pt(...TOKYO)], [pt(...TOKYO)], MAP);
    expect(widthKm(spans)).toBeCloseTo(HOME_MIN_KM, 6);
    const walk = homeSpans([pt(35.68, 139.76), pt(35.682, 139.765)], [pt(...TOKYO)], MAP);
    expect(widthKm(walk)).toBeCloseTo(HOME_MIN_KM, 6);
  });

  it("widens around the same middle to bring the nearest town into view, but not past its limit", () => {
    const stop = pt(35.68, 139.76);
    const townNear = pt(35.68, 139.76 + 12 / (111.32 * proj.kx)); // 12 km east
    const near = homeSpans([stop], [townNear], MAP);
    expect(near.cx).toBeCloseTo(stop.x, 9);
    expect(widthKm(near)).toBeGreaterThan(24);
    expect(widthKm(near)).toBeLessThanOrEqual(CONTEXT_MAX_KM + 1e-9);
    const halfW = (widthKm(near) / 111.32) / 2;
    expect(Math.abs(townNear.x - near.cx)).toBeLessThanOrEqual(halfW * 0.8 + 1e-9);
    // A town 30 km away would take 75 km: a lone stop gets the limit instead, to show the land around it.
    const townFar = pt(35.68, 139.76 + 30 / (111.32 * proj.kx));
    expect(widthKm(homeSpans([stop], [townFar], MAP))).toBeCloseTo(CONTEXT_MAX_KM, 6);
    // A town already in view changes nothing.
    expect(widthKm(homeSpans([stop], [stop], MAP))).toBeCloseTo(HOME_MIN_KM, 6);
  });

  it("shows the land around one place alone with no town near, but never parts close stops for it", () => {
    const lone = pt(...TOKYO);
    expect(widthKm(homeSpans([lone], [], MAP))).toBeCloseTo(CONTEXT_MAX_KM, 6);
    // Stops 300 m apart keep the narrow view rather than merge.
    const walk = [at(35.68, 139.76), at(35.6827, 139.76)];
    const close = closestPlacesKm(walk, [0, 1]);
    expect(close).toBeCloseTo(0.3, 1);
    expect(widthKm(homeSpans(walk.map((w) => pt(w.lat, w.lon)), [], MAP, close))).toBeCloseTo(HOME_MIN_KM, 6);
    // A venue visited twice is one place.
    expect(closestPlacesKm([at(35.68, 139.76), at(35.68001, 139.76)], [0, 1])).toBe(Infinity);
    // A town 12 km away comes into view for a stop, but not for stops that would merge at that width.
    const town = pt(35.68, 139.76 + 12 / (111.32 * proj.kx));
    expect(widthKm(homeSpans(walk.map((w) => pt(w.lat, w.lon)), [town], MAP, close))).toBeCloseTo(HOME_MIN_KM, 6);
    expect(widthKm(homeSpans([lone], [town], MAP))).toBeGreaterThan(24);
  });

  it("leaves a wide spread of stops as it is", () => {
    const spread = [pt(35.68, 139.76), pt(35.01, 135.77)];
    const spans = homeSpans(spread, [], MAP);
    expect(spans.spanX).toBeCloseTo(Math.abs(spread[0]!.x - spread[1]!.x), 9);
    expect(spans.spanY).toBeCloseTo(Math.abs(spread[0]!.y - spread[1]!.y), 9);
  });
});

describe("what the outline map points at", () => {
  it("draws town labels of every rank close in and only the biggest far out", () => {
    expect([10, 80, 81, 250, 800, 2500, 7000, 20000].map(cityRankLimit)).toEqual([7, 7, 6, 6, 5, 4, 3, 2]);
  });

  it("puts each pointer on the edge, toward its stop, and merges pointers that would touch", () => {
    const [east] = edgePointers([{ index: 0, x: 10_000, y: 170 }], 400, 340);
    expect(east).toMatchObject({ members: [0], x: 376, y: 170, angle: 0 });
    const [nw] = edgePointers([{ index: 0, x: -1000, y: -1000 }], 400, 340);
    expect(nw!.y).toBeCloseTo(24, 6);
    // The line from the middle (200, 170) toward it meets the top edge first, at y = 24.
    expect(nw!.x).toBeCloseTo(200 - 1200 * (146 / 1170), 6);
    expect(compass(nw!.angle)).toBe("north-west");
    const both = edgePointers([{ index: 0, x: 10_000, y: 170 }, { index: 1, x: 10_000, y: 400 }, { index: 2, x: -10_000, y: 170 }], 400, 340);
    expect(both.map((p) => p.members.sort())).toEqual([[0, 1], [2]]);
    // Two pointers either side of due west, at -179 and 179 degrees, are one.
    expect(edgePointers([{ index: 0, x: -10_000, y: 160 }, { index: 1, x: -10_000, y: 180 }], 400, 340)).toHaveLength(1);
    // A pointer always sits inside the inset, on the line toward its stop.
    const corner = edgePointers([{ index: 0, x: 380, y: 300 }], 400, 340)[0]!;
    expect(corner.x).toBeCloseTo(376, 6);
    expect((corner.y - 170) / (corner.x - 200)).toBeCloseTo(130 / 180, 9);
  });

  it("names the eight directions for a screen angle", () => {
    expect([0, 45, 90, 135, 180, -135, -90, -45, -180, 359].map(compass)).toEqual(["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east", "west", "east"]);
  });
});
