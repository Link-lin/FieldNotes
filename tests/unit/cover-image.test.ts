import { describe, expect, it } from "vitest";
import { COVER_IMAGE, coverSizeProblem, encodeWithinBudget, fitWithin, FULL_STEPS, SMALL_QUALITY, type Size } from "@/features/trips/TripDetails/CoverSection/cover-image";

// A stand-in for the canvas: its JPEG grows with the pixels and the quality.
const encoder = (bytesPerPixel: number, calls: Array<[number, number, number]> = []) => async (size: Size, quality: number) => {
  calls.push([size.width, size.height, quality]);
  return new Blob([new Uint8Array(Math.round(size.width * size.height * quality * bytesPerPixel))]);
};

describe("cover image (browser)", () => {
  it("fits the long edge and never enlarges", () => {
    expect(fitWithin({ width: 4032, height: 3024 }, COVER_IMAGE.fullEdge)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin({ width: 1024, height: 1536 }, COVER_IMAGE.smallEdge)).toEqual({ width: 320, height: 480 });
    expect(fitWithin({ width: 800, height: 600 }, COVER_IMAGE.fullEdge)).toEqual({ width: 800, height: 600 });
  });

  it("refuses a tiny image and one more than three times as long as it is wide", () => {
    expect(coverSizeProblem({ width: 199, height: 800 })).toMatch(/200 pixels/);
    expect(coverSizeProblem({ width: 900, height: 300 })).toBeNull();
    expect(coverSizeProblem({ width: 901, height: 300 })).toMatch(/three times/);
    expect(coverSizeProblem({ width: 300, height: 1000 })).toMatch(/three times/);
    expect(coverSizeProblem({ width: 1024, height: 1536 })).toBeNull();
  });

  it("makes the small image, then steps the full one down until both fit", async () => {
    const calls: Array<[number, number, number]> = [];
    const files = await encodeWithinBudget({ width: 4000, height: 3000 }, encoder(0.6, calls));
    expect(calls).toEqual([
      [480, 360, SMALL_QUALITY],
      [1600, 1200, FULL_STEPS[0]!.quality],
      [1600, 1200, FULL_STEPS[1]!.quality],
    ]);
    expect(files!.full.size + files!.small.size).toBeLessThanOrEqual(COVER_IMAGE.budget);
  });

  it("gives up when nothing fits, or when the browser can't encode", async () => {
    const calls: Array<[number, number, number]> = [];
    expect(await encodeWithinBudget({ width: 4000, height: 3000 }, encoder(5, calls))).toBeNull();
    expect(calls).toHaveLength(1 + FULL_STEPS.length);
    expect(calls.at(-1)).toEqual([1280, 960, 0.7]);
    expect(await encodeWithinBudget({ width: 4000, height: 3000 }, async () => null)).toBeNull();
  });
});
