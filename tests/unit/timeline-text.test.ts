import { describe, expect, it } from "vitest";
import type { PlanItemDTO } from "@/shared/dto";
import { hasTime, titleRestatesRoute } from "@/features/trips/TripPage/trip-days";

const endpoint = (localDateTime: string | null) => ({ airportCode: "SFO", localDateTime, timeZone: null, timeDisambiguation: null });
const item = (over: Partial<PlanItemDTO>) => ({ localTime: null, flightDetails: null, ...over }) as PlanItemDTO;
const flight = (departureAt: string | null) =>
  item({ flightDetails: { plannedDepartureDate: null, airline: null, flightNumber: null, departure: endpoint(departureAt), arrival: endpoint(null) } });

describe("less repetition in the timeline (I7)", () => {
  it("shows a time line only for events and flights that have a clock time", () => {
    expect(hasTime(item({ localTime: "18:30" }))).toBe(true);
    expect(hasTime(item({ localTime: null }))).toBe(false);
    expect(hasTime(flight("2026-10-19T08:05"))).toBe(true);
    expect(hasTime(flight(null))).toBe(false);
  });

  it("drops a flight title that only restates its airports", () => {
    expect(titleRestatesRoute("SFO → HNL", "SFO", "HNL")).toBe(true);
    expect(titleRestatesRoute("sfo to hnl", "SFO", "HNL")).toBe(true);
    expect(titleRestatesRoute("SFO-HNL", "SFO", "HNL")).toBe(true);
    expect(titleRestatesRoute("KOA → SFO (red-eye)", "KOA", "SFO")).toBe(false);
    expect(titleRestatesRoute("Outbound flight", "SFO", "KIX")).toBe(false);
    expect(titleRestatesRoute("SFO → HNL", "SFO", null)).toBe(false);
  });
});
