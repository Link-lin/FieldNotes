import { describe, expect, it } from "vitest";
import { previewGlance } from "@/features/import/ImportPage/preview-summary";

describe("AI import preview card summary (I3)", () => {
  it("shows an event's time, place and formatted price, naming a zone other than the trip's", () => {
    expect(previewGlance({ type: "activity", localDate: "2027-04-10", localTime: "10:30", location: "Nishiki Market, Kyoto", plannedPrice: { amount: "3000", currency: "JPY" } }, "Asia/Tokyo"))
      .toEqual({ time: "10:30", place: "Nishiki Market, Kyoto", price: "¥3,000" });
    expect(previewGlance({ type: "other", localDate: "2027-04-11", localTime: "14:00", timeZone: "America/Los_Angeles" }, "Asia/Tokyo").time).toBe("14:00 (America/Los_Angeles)");
    expect(previewGlance({ type: "other", localDate: "2027-04-11", localTime: "14:00", timeZone: "Asia/Tokyo" }, "Asia/Tokyo").time).toBe("14:00");
    expect(previewGlance({ type: "meal", localDate: "2027-04-11", localTime: null, location: null, plannedPrice: null }, "Asia/Tokyo")).toEqual({ time: null, place: null, price: null });
  });

  it("shows a flight's airports with their local times, or as much of the route as is known", () => {
    const flight = (departure: unknown, arrival: unknown) => ({ type: "flight", flightDetails: { departure, arrival }, plannedPrice: { amount: "680.00", currency: "USD" } });
    expect(previewGlance(flight({ airportCode: "SFO", localDateTime: "2027-04-08T11:00", timeZone: "America/Los_Angeles" }, { airportCode: "KIX", localDateTime: "2027-04-09T15:10", timeZone: "Asia/Tokyo" }), "Asia/Tokyo"))
      .toEqual({ time: "SFO 11:00 → KIX 15:10", place: null, price: "$680" });
    expect(previewGlance(flight({ airportCode: "SFO" }, { airportCode: "KIX" }), "Asia/Tokyo").time).toBe("SFO → KIX");
    expect(previewGlance(flight({ airportCode: null }, { airportCode: "KIX" }), "Asia/Tokyo").time).toBe("··· → KIX");
    expect(previewGlance({ type: "flight", flightDetails: {} }, "Asia/Tokyo").time).toBeNull();
  });

  it("shows values that still need fixing as typed and never formats an invalid price", () => {
    expect(previewGlance({ type: "activity", localTime: "25:00", plannedPrice: { amount: "12,50", currency: "EUR" } }, "Asia/Tokyo")).toMatchObject({ time: "25:00", price: "12,50 EUR" });
    expect(previewGlance({ type: "activity", plannedPrice: { amount: "12", currency: "EURO" } }, null).price).toBe("12 EURO");
    expect(previewGlance({ type: "activity", plannedPrice: { currency: "EUR" } }, null).price).toBe("EUR");
    expect(previewGlance({ type: "flight", flightDetails: { departure: { airportCode: "SFO", localDateTime: "tomorrow" }, arrival: null } }, null).time).toBe("SFO tomorrow → ···");
  });
});
