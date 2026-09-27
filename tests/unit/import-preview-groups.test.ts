import { describe, expect, it } from "vitest";
import { groupPreviewItems } from "@/features/import/ImportPage/preview-groups";
import type { ImportPreviewDTO } from "@/shared/import";

type Row = ImportPreviewDTO["items"][number];
const row = (index: number, values: Record<string, unknown>): Row => ({ index, values, errors: [], included: true });

describe("AI import day-by-day preview", () => {
  it("groups dated, unscheduled, undated, and flight items without changing source indices", () => {
    const groups = groupPreviewItems([
      row(0, { type: "activity", localDate: "2027-04-16", localTime: null }),
      row(1, { type: "flight", flightDetails: { departure: { localDateTime: "2027-04-14T22:00", timeZone: "America/Los_Angeles" } } }),
      row(2, { type: "meal", localDate: "2027-04-14", localTime: "09:00" }),
      row(3, { type: "flight", flightDetails: {} }),
      row(4, { type: "other", localDate: null }),
    ], "Asia/Tokyo");
    expect(groups.map((group) => group.key)).toEqual(["2027-04-14", "2027-04-16", "undated-flights", "undated"]);
    expect(groups[0]?.timed.map((item) => item.index)).toEqual([2, 1]);
    expect(groups[1]?.unscheduled.map((item) => item.index)).toEqual([0]);
    expect(groups[2]?.unscheduled.map((item) => item.index)).toEqual([3]);
    expect(groups[3]?.unscheduled.map((item) => item.index)).toEqual([4]);
  });

  it("keeps malformed dates and zones visible for correction instead of throwing", () => {
    const groups = groupPreviewItems([
      row(0, { type: "activity", localDate: "2027-02-30", localTime: "11:00" }),
      row(1, { type: "meal", localDate: "2027-04-14", localTime: "10:00", timeZone: "Not/A_Zone" }),
      row(2, { type: "flight", flightDetails: { departure: { localDateTime: "2027-04-15T10:00", timeZone: "Not/A_Zone" } } }),
    ], "Asia/Tokyo");
    expect(groups.map((group) => group.key)).toEqual(["2027-04-14", "2027-04-15", "needs-correction"]);
    expect(groups[0]?.unscheduled.map((item) => item.index)).toEqual([1]);
    expect(groups[1]?.unscheduled.map((item) => item.index)).toEqual([2]);
    expect(groups[2]?.unscheduled.map((item) => item.index)).toEqual([0]);
  });
});
