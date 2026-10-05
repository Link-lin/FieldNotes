import { describe, expect, it } from "vitest";
import type { PlanItemDTO } from "@/shared/dto";
import { itemInputOf, mergeFields, mergeItemFields, sameValue, tripFieldsOf } from "@/shared/fields";
import { itemFieldsPatchSchema, itemInputSchema, tripFieldsPatchSchema, tripFieldsSchema } from "@/shared/schemas";

const activity: PlanItemDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 3,
  type: "activity",
  title: "Fushimi Inari at sunrise",
  source: "manual",
  reviewedAt: null,
  location: "Fushimi Inari Taisha, Kyoto",
  notes: "Go early",
  links: [],
  mapUrl: null,
  mapProvider: null,
  coordinates: null,
  bookingStatus: "not_required",
  bookingDueDate: null,
  bookingDueState: null,
  plannedPrice: { amount: "12.5", currency: "JPY", label: "estimate", source: "owner" },
  localDate: "2026-11-16",
  localTime: "06:00",
  timeZone: null,
  timeDisambiguation: null,
  durationMinutes: 90,
  timelineDate: "2026-11-16",
  sortInstant: "2026-11-15T21:00:00.000Z",
  flightDetails: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("field-level saves (TRIP-10)", () => {
  it("compares values whatever their key order", () => {
    expect(sameValue({ amount: "1", currency: "USD" }, { currency: "USD", amount: "1" })).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue({ amount: "1" }, { amount: "1.0" })).toBe(false);
  });

  it("merges only the changed fields when each still holds its starting value", () => {
    const current = itemInputOf(activity);
    const r = mergeItemFields(current, { title: "Inari" }, { title: "Fushimi Inari at sunrise" });
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toEqual({ ...current, title: "Inari" });
    expect(itemInputSchema.safeParse(r.merged).success).toBe(true);
  });

  it("reports a changed field that was changed elsewhere and merges nothing", () => {
    const current = { ...itemInputOf(activity), title: "Changed by a chat" };
    const r = mergeItemFields(current, { title: "Mine", location: "Kyoto" }, { title: "Fushimi Inari at sunrise", location: "Fushimi Inari Taisha, Kyoto" });
    expect(r.conflicts).toEqual(["title"]);
    expect(r.merged.title).toBe("Changed by a chat");
  });

  it("is no clash when another field changed elsewhere", () => {
    const current = { ...itemInputOf(activity), localTime: "07:30" };
    const r = mergeItemFields(current, { notes: "Bring cash" }, { notes: "Go early" });
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toMatchObject({ notes: "Bring cash", localTime: "07:30" });
  });

  it("swaps the schedule fields when an event becomes a flight, keeping what the save sets", () => {
    const r = mergeItemFields(itemInputOf(activity), { type: "flight", bookingStatus: "needs_booking", airline: "JAL" }, { type: "activity", bookingStatus: "not_required", airline: null });
    expect(r.merged).not.toHaveProperty("localDate");
    expect(r.merged).not.toHaveProperty("durationMinutes");
    expect(r.merged).toMatchObject({ type: "flight", airline: "JAL", plannedDepartureDate: null, departure: { airportCode: null }, arrival: { localDateTime: null } });
    expect(itemInputSchema.safeParse(r.merged).success).toBe(true);
  });

  it("drops a flight's schedule when it becomes another type", () => {
    const flight: PlanItemDTO = {
      ...activity,
      type: "flight",
      bookingStatus: "needs_booking",
      localDate: null,
      localTime: null,
      durationMinutes: null,
      flightDetails: {
        plannedDepartureDate: "2026-11-15",
        airline: "JAL",
        flightNumber: "JL1",
        departure: { airportCode: "SFO", localDateTime: null, timeZone: null, timeDisambiguation: null },
        arrival: { airportCode: "HND", localDateTime: null, timeZone: null, timeDisambiguation: null },
      },
    };
    const r = mergeItemFields(itemInputOf(flight), { type: "transport" }, { type: "flight" });
    expect(r.merged).not.toHaveProperty("departure");
    expect(r.merged).toMatchObject({ type: "transport", localDate: null, localTime: null, durationMinutes: null });
    expect(itemInputSchema.safeParse(r.merged).success).toBe(true);
  });

  it("keeps the schedule when an event changes between other types", () => {
    const r = mergeItemFields(itemInputOf(activity), { type: "meal" }, { type: "activity" });
    expect(r.merged).toMatchObject({ type: "meal", localDate: "2026-11-16", localTime: "06:00" });
  });

  it("merges trip fields the same way", () => {
    const trip = tripFieldsOf({ title: "Kyoto", destination: "Kyoto, Japan", startDate: "2026-11-15", endDate: "2026-11-20", timeZone: "Asia/Tokyo", budget: null, atlasLocation: { latitude: 35, longitude: 135.7 } });
    const ok = mergeFields(trip, { budget: { amount: "3000", currency: "USD" } }, { budget: null });
    expect(ok.conflicts).toEqual([]);
    expect(tripFieldsSchema.safeParse(ok.merged).success).toBe(true);
    expect(mergeFields(trip, { title: "Mine" }, { title: "Osaka" }).conflicts).toEqual(["title"]);
    // The merged trip still has to make sense as a whole.
    const reversed = mergeFields(trip, { endDate: "2026-11-01" }, { endDate: "2026-11-20" });
    expect(tripFieldsSchema.safeParse(reversed.merged).success).toBe(false);
  });

  it("accepts only known fields, at least one change, and a starting value for each", () => {
    expect(itemFieldsPatchSchema.safeParse({ changes: { title: "A" }, base: { title: "B" } }).success).toBe(true);
    expect(itemFieldsPatchSchema.safeParse({ changes: {}, base: {} }).success).toBe(false);
    expect(itemFieldsPatchSchema.safeParse({ changes: { title: "A" }, base: {} }).success).toBe(false);
    expect(itemFieldsPatchSchema.safeParse({ changes: { source: "manual" }, base: { source: "ai" } }).success).toBe(false);
    expect(itemFieldsPatchSchema.safeParse({ changes: { reviewedAt: null }, base: { reviewedAt: "x" } }).success).toBe(false);
    expect(tripFieldsPatchSchema.safeParse({ changes: { atlasLocation: null }, base: { atlasLocation: { latitude: 1, longitude: 2 } } }).success).toBe(true);
    expect(tripFieldsPatchSchema.safeParse({ changes: { version: 9 }, base: { version: 8 } }).success).toBe(false);
  });
});
