import { describe, expect, it } from "vitest";
import { newlyOutside } from "@/features/trips/TripForm/date-range";

const trip = { startDate: "2026-10-18", endDate: "2026-10-25" };
const dates = ["2026-10-17", "2026-10-18", "2026-10-20", "2026-10-25", "2026-10-25"];

describe("newlyOutside", () => {
  it("counts only events the new range pushes out", () => {
    expect(newlyOutside(dates, trip, { startDate: "2026-10-18", endDate: "2026-10-24" })).toBe(2);
    expect(newlyOutside(dates, trip, { startDate: "2026-10-19", endDate: "2026-10-25" })).toBe(1);
  });
  it("does not count events that were already outside, or any when the range grows", () => {
    expect(newlyOutside(dates, trip, trip)).toBe(0);
    expect(newlyOutside(dates, trip, { startDate: "2026-10-10", endDate: "2026-10-30" })).toBe(0);
  });
  it("counts nothing while a date is missing", () => {
    expect(newlyOutside(dates, trip, { startDate: "", endDate: "2026-10-19" })).toBe(0);
  });
});
