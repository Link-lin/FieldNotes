import { describe, expect, it } from "vitest";
import { itemInputSchema, toFieldErrors, tripInputSchema } from "@/shared/schemas";

const base = { title: "Dinner", location: null, notes: null, links: [], mapUrl: null, bookingStatus: "not_required", bookingDueDate: null, plannedPrice: null };
const other = { ...base, type: "meal", localDate: "2026-11-16", localTime: "19:00", timeZone: null, timeDisambiguation: null, durationMinutes: null };
const ep = { airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null };
const flight = { ...base, type: "flight", bookingStatus: "needs_booking", plannedDepartureDate: null, airline: null, flightNumber: null, departure: ep, arrival: ep };

const paths = (r: ReturnType<typeof itemInputSchema.safeParse>) => (r.success ? [] : toFieldErrors(r.error).map((e) => e.path));

describe("item validation", () => {
  it("accepts a normal event and trims text", () => {
    const r = itemInputSchema.safeParse({ ...other, title: "  Dinner  ", notes: "  " });
    expect(r.success && r.data.title).toBe("Dinner");
    expect(r.success && r.data.notes).toBeNull();
  });
  it("rejects a time without a date and unknown fields", () => {
    expect(paths(itemInputSchema.safeParse({ ...other, localDate: null }))).toContain("localTime");
    expect(itemInputSchema.safeParse({ ...other, source: "manual" }).success).toBe(false);
  });
  it("allows a book-by date only while the event needs booking", () => {
    expect(paths(itemInputSchema.safeParse({ ...other, bookingDueDate: "2026-10-01" }))).toContain("bookingDueDate");
    expect(itemInputSchema.safeParse({ ...other, bookingStatus: "needs_booking", bookingDueDate: "2026-10-01" }).success).toBe(true);
  });
  it("requires airports, local times and zones before a flight is booked", () => {
    const p = paths(itemInputSchema.safeParse({ ...flight, bookingStatus: "booked" }));
    expect(p).toEqual(expect.arrayContaining(["departure.airportCode", "arrival.localDateTime", "arrival.timeZone"]));
    expect(paths(itemInputSchema.safeParse({ ...flight, bookingStatus: "not_required" }))).toContain("bookingStatus");
  });
  it("accepts JSON v1 flight-field limits in the manual editor", () => {
    const input = {
      ...flight,
      airline: "A".repeat(120),
      flightNumber: "F".repeat(24),
      departure: { ...ep, airportCode: "ksfo" },
      arrival: { ...ep, airportCode: "RJTT" },
    };
    const parsed = itemInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "flight") expect(parsed.data.departure.airportCode).toBe("KSFO");
    expect(paths(itemInputSchema.safeParse({ ...input, airline: "A".repeat(121) }))).toContain("airline");
    expect(paths(itemInputSchema.safeParse({ ...input, flightNumber: "F".repeat(25) }))).toContain("flightNumber");
    expect(paths(itemInputSchema.safeParse({ ...input, departure: { ...ep, airportCode: "KSSFO" } }))).toContain("departure.airportCode");
  });
  it("rejects float money, fake currencies and non-http links", () => {
    expect(itemInputSchema.safeParse({ ...other, plannedPrice: { amount: 12.5, currency: "USD", label: "estimate" } }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...other, plannedPrice: { amount: "12.50", currency: "ABC", label: "estimate" } }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...other, links: [{ label: "x", url: "javascript:alert(1)" }] }).success).toBe(false);
  });
});

describe("trip validation", () => {
  it("requires start on or before end and a real time zone", () => {
    const t = { title: "T", destination: "Tokyo, Japan", startDate: "2026-11-15", endDate: "2026-11-14", timeZone: "Asia/Tokyo", budget: null };
    expect(tripInputSchema.safeParse(t).success).toBe(false);
    expect(tripInputSchema.safeParse({ ...t, endDate: "2026-11-15", timeZone: "+09:00" }).success).toBe(false);
    expect(tripInputSchema.safeParse({ ...t, endDate: "2026-11-15" }).success).toBe(true);
  });
});

describe("trip length", () => {
  const trip = { title: "Long", destination: "Kyoto, Japan", startDate: "2026-01-01", timeZone: "Asia/Tokyo", budget: null };
  it("accepts a trip of exactly the maximum length and rejects one day more, for new, edited and imported trips", async () => {
    const { tripDraftSchema } = await import("@/shared/import");
    const { tripPatchSchema } = await import("@/shared/schemas");
    const longest = { ...trip, endDate: "2027-02-04" }; // 400 days including both ends
    const tooLong = { ...trip, endDate: "2027-02-05" };
    expect(tripInputSchema.safeParse(longest).success).toBe(true);
    const r = tripInputSchema.safeParse(tooLong);
    expect(r.success ? [] : toFieldErrors(r.error).map((e) => e.path)).toEqual(["endDate"]);
    expect(tripPatchSchema.safeParse({ ...tooLong, expectedVersion: 1 }).success).toBe(false);
    expect(tripDraftSchema.safeParse(tooLong).success).toBe(false);
  });
});
