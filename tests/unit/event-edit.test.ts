import { describe, expect, it } from "vitest";
import { bookingForType, changedFields, whenDraftOf, whenFields } from "@/features/trips/TripPage/EventPanel/event-edit";

describe("event view edits (TRIP-9, TRIP-10)", () => {
  it("keeps an event's booking valid when it becomes a flight (FLIGHT-2)", () => {
    expect(bookingForType("not_required", true)).toBe("needs_booking");
    // The change clears the schedule, so a booked event can't stay a booked flight.
    expect(bookingForType("booked", true)).toBe("needs_booking");
    expect(bookingForType("booked", true, true)).toBe("booked");
    expect(bookingForType("needs_booking", true)).toBe("needs_booking");
    // Any other type keeps what it had.
    expect(bookingForType("booked", false)).toBe("booked");
    expect(bookingForType("not_required", false)).toBe("not_required");
  });

  it("sends only the fields that changed from where the edit began", () => {
    const start = whenFields(whenDraftOf(null, "2026-11-16"));
    const next = whenFields({ ...whenDraftOf(null, "2026-11-16"), time: "09:30" });
    expect(changedFields(next, start)).toEqual({ localTime: "09:30" });
    expect(changedFields(start, start)).toEqual({});
  });
});
