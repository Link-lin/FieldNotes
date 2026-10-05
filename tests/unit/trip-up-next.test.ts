import { describe, expect, it } from "vitest";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { flightRoute, upNext } from "@/features/trips/TripPage/trip-days";

type Trip = TripDetailDTO["trip"];
const trip = (over: Partial<Trip>): Trip => ({
  id: "t", title: "Trip", destination: "Honolulu", startDate: "2026-10-19", endDate: "2026-10-26", timeZone: "Pacific/Honolulu",
  status: "upcoming", daysToStart: 21, dayIndex: null, daysSinceEnd: null, dayCount: 8, role: "owner", ownerName: null, creatorGone: false, atlasLocation: null,
  version: 1, budget: null, today: "2026-09-28", primaryOwner: true, ...over,
});
const endpoint = (airportCode: string | null) => ({ airportCode, localDateTime: null, timeZone: null, timeDisambiguation: null });
const item = (id: string, timelineDate: string | null, sortInstant: string | null = null, over: Partial<PlanItemDTO> = {}): PlanItemDTO => ({
  id, version: 1, type: "activity", title: id, source: "manual", reviewedAt: null, location: null, notes: null, links: [], mapUrl: null, mapProvider: null, coordinates: null,
  bookingStatus: "not_required", bookingDueDate: null, bookingDueState: null, plannedPrice: null, localDate: timelineDate, localTime: null, timeZone: null,
  timeDisambiguation: null, durationMinutes: null, timelineDate, sortInstant, flightDetails: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...over,
});
const flight = (id: string, date: string | null, from: string | null, to: string | null) =>
  item(id, date, null, { type: "flight", flightDetails: { plannedDepartureDate: date, airline: null, flightNumber: null, departure: endpoint(from), arrival: endpoint(to) } });

describe("the header's Up next card", () => {
  it("shows an upcoming trip's first dated event, skipping undated ones", () => {
    const items = [item("parking", "2026-10-18", "2026-10-19T03:00:00Z"), item("hotel", "2026-10-19"), item("undated", null)];
    expect(upNext(trip({}), items, null)).toEqual({ item: items[0], label: "Sun 18 Oct" });
  });

  it("during the trip, skips today's events that have started once the browser's clock is known", () => {
    const ongoing = trip({ status: "ongoing", today: "2026-10-20", dayIndex: 2 });
    const items = [
      item("yesterday", "2026-10-19", "2026-10-19T20:00:00Z"),
      item("morning", "2026-10-20", "2026-10-20T17:30:00Z"),
      item("evening", "2026-10-20", "2026-10-21T04:00:00Z"),
      item("tomorrow", "2026-10-21", "2026-10-21T20:00:00Z"),
    ];
    // Before hydration: day-level, so today's first event.
    expect(upNext(ongoing, items, null)?.item.id).toBe("morning");
    const noon = Date.parse("2026-10-20T22:00:00Z"); // 12:00 in Honolulu
    expect(upNext(ongoing, items, noon)).toMatchObject({ item: { id: "evening" }, label: "Today" });
    expect(upNext(ongoing, items, Date.parse("2026-10-21T05:00:00Z"))).toMatchObject({ item: { id: "tomorrow" }, label: "Tomorrow" });
  });

  it("keeps a date-only event for today and shows nothing for a past trip or when nothing is left", () => {
    const ongoing = trip({ status: "ongoing", today: "2026-10-20" });
    expect(upNext(ongoing, [item("beach day", "2026-10-20")], Date.parse("2026-10-21T08:00:00Z"))?.item.id).toBe("beach day");
    expect(upNext(ongoing, [item("done", "2026-10-20", "2026-10-20T18:00:00Z")], Date.parse("2026-10-20T22:00:00Z"))).toBeNull();
    expect(upNext(trip({ status: "past", today: "2026-11-30" }), [item("later", "2026-12-01")], null)).toBeNull();
  });

  it("joins connecting flights into one route and starts a new run after a gap", () => {
    const items = [flight("a", "2026-10-19", "SFO", "HNL"), flight("b", "2026-10-22", "HNL", "OGG"), flight("c", "2026-10-25", "OGG", "KOA"), flight("d", "2026-10-26", "KOA", "SFO"), flight("backup", null, "KOA", "HNL")];
    expect(flightRoute(items)).toBe("SFO → HNL → OGG → KOA → SFO");
    expect(flightRoute([flight("a", "2026-10-19", "SFO", "HNL"), flight("b", "2026-10-22", "OGG", "KOA")])).toBe("SFO → HNL · OGG → KOA");
    expect(flightRoute([flight("a", "2026-10-19", "SFO", null), item("x", "2026-10-19")])).toBeNull();
  });
});
