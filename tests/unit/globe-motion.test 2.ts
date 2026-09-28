import { describe, expect, it } from "vitest";
import { glide, type Motion, ZOOM_MAX, clampZoom } from "@/features/dashboard/Dashboard/Globe/globe-motion";

const run = (m: Motion, ms: number, dragging = false) => {
  let frames = 0;
  for (let t = 0; t < ms; t += 16) if (glide(m, 16, dragging)) frames++;
  return frames;
};

describe("globe motion", () => {
  it("glides zoom toward its target and settles", () => {
    const m: Motion = { rot: [0, 0], zoom: 1, target: 2, vel: [0, 0] };
    glide(m, 16, false);
    expect(m.zoom).toBeGreaterThan(1);
    expect(m.zoom).toBeLessThan(2);
    run(m, 2000);
    expect(m.zoom).toBe(2);
    expect(glide(m, 16, false)).toBe(false);
  });

  it("coasts after a fling, slows down, then stops", () => {
    const m: Motion = { rot: [0, 0], zoom: 1, target: 1, vel: [0.3, 0] };
    const frames = run(m, 4000);
    expect(frames).toBeGreaterThan(10);
    expect(m.rot[0]).toBeGreaterThan(50);
    expect(m.vel).toEqual([0, 0]);
  });

  it("does not coast while the pointer is still down", () => {
    const m: Motion = { rot: [10, 0], zoom: 1, target: 1, vel: [0.3, 0] };
    expect(glide(m, 16, true)).toBe(false);
    expect(m.rot).toEqual([10, 0]);
  });

  it("keeps latitude and zoom in range", () => {
    const m: Motion = { rot: [0, 70], zoom: 1, target: 1, vel: [0, 0.5] };
    run(m, 4000);
    expect(m.rot[1]).toBeLessThanOrEqual(80);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });
});
