import { describe, expect, it } from "vitest";
import { roadRuns, routeChunks } from "@/features/trips/TripPage/MapPanel/GoogleRoadMap/road-runs";
import type { Stop } from "@/features/trips/TripPage/trip-days";

const stop = (n: number, day = "2026-10-18", flight = false): Stop => ({ id: String(n), n, name: String(n), lat: 21, lon: -157 + n / 100, flight, airport: flight ? "HNL" : null, need: false, day, dayLabel: day });

describe("road-route groups", () => {
  it("breaks at flights and day boundaries", () => {
    const runs = roadRuns([stop(1), stop(2), stop(3, undefined, true), stop(4), stop(5), stop(6, "2026-10-19"), stop(7, "2026-10-19")]);
    expect(runs.map((r) => r.map((s) => s.n))).toEqual([[1, 2], [3, 4, 5], [6, 7]]);
  });

  it("splits long runs into overlapping embeds with at most 20 intermediate stops", () => {
    const chunks = routeChunks(Array.from({ length: 45 }, (_, n) => stop(n + 1)));
    expect(chunks.map((c) => [c[0]?.n, c[c.length - 1]?.n])).toEqual([[1, 22], [22, 43], [43, 45]]);
    expect(chunks.every((c) => c.length <= 22)).toBe(true);
  });
});
