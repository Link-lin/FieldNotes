import { describe, expect, it } from "vitest";
import { outlinePaths, outlineProjection } from "@/features/trips/TripPage/MapPanel/DayMap/geography";

describe("day map's bundled geographic outline", () => {
  it("keeps Hawaiian places aligned with their pins and draws nearby land", () => {
    const lon = -157.86;
    const lat = 21.31;
    const horizontalScale = Math.cos((lat * Math.PI) / 180);
    const projection = outlineProjection({
      medianLon: lon,
      horizontalScale,
      fitScale: 35,
      centerX: lon * horizontalScale,
      centerY: -lat,
      width: 400,
      height: 340,
    });
    const honolulu = projection([lon, lat]);
    const hilo = projection([-155.09, 19.7]);
    expect(honolulu?.[0]).toBeCloseTo(200);
    expect(honolulu?.[1]).toBeCloseTo(170);
    expect(hilo?.[0]).toBeGreaterThan(honolulu![0]);
    expect(hilo?.[1]).toBeGreaterThan(honolulu![1]);
    expect(outlinePaths(projection).land.length).toBeGreaterThan(100);
  });

  it("places stops on either side of the date line close together", () => {
    const projection = outlineProjection({
      medianLon: -180,
      horizontalScale: 1,
      fitScale: 20,
      centerX: -180,
      centerY: 0,
      width: 400,
      height: 340,
    });
    const west = projection([179.8, 0]);
    const east = projection([-179.8, 0]);
    expect(west).not.toBeNull();
    expect(east).not.toBeNull();
    expect(Math.abs(west![0] - east![0])).toBeLessThan(10);
  });
});
