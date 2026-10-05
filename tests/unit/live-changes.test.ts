import { describe, expect, it } from "vitest";
import { changesMessage, liveChanges } from "@/features/trips/TripPage/live-changes";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";

const item = (id: string, over: Partial<PlanItemDTO> = {}): PlanItemDTO => ({
  id, version: 1, type: "activity", title: `Event ${id}`, source: "ai", location: "Kinkaku-ji, Kyoto", notes: null, links: [], mapUrl: null, mapProvider: null,
  coordinates: null, bookingStatus: "not_required", bookingDueDate: null, bookingDueState: null, plannedPrice: null, localDate: "2026-10-20", localTime: "10:00",
  timeZone: null, timeDisambiguation: null, durationMinutes: null, timelineDate: "2026-10-20", sortInstant: "2026-10-20T01:00:00.000Z", flightDetails: null,
  createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z", ...over,
}) as PlanItemDTO;

const trip = (over: Partial<TripDetailDTO["trip"]> = {}) => ({ title: "Kyoto", destination: "Kyoto, Japan", startDate: "2026-10-20", endDate: "2026-10-24", timeZone: "Asia/Tokyo", budget: null, role: "owner", ...over }) as TripDetailDTO["trip"];

describe("live changes (TRIP-11)", () => {
  it("tells added, changed, newly pinned and removed events apart", () => {
    const before = [item("a"), item("b"), item("c"), item("d")];
    const pin = { mapUrl: "https://www.openstreetmap.org/?mlat=35.03937&mlon=135.72924", mapProvider: "OpenStreetMap", coordinates: { latitude: 35.03937, longitude: 135.72924, source: "map_link" as const } };
    const after = [item("a"), item("b", { version: 2, title: "Golden Pavilion", updatedAt: "2026-10-04T00:01:00.000Z" }), item("c", { version: 2, updatedAt: "2026-10-04T00:01:00.000Z", ...pin }), item("e")];
    expect(liveChanges(before, after)).toEqual({ added: ["e"], changed: ["b"], pinned: ["c"], removed: ["d"] });
    // A pin that comes with another change is a change.
    expect(liveChanges([item("c")], [item("c", { version: 2, localTime: "11:00", ...pin })]).changed).toEqual(["c"]);
    // Losing a pin is a change, not a pin.
    expect(liveChanges([item("c", pin)], [item("c", { version: 2 })]).changed).toEqual(["c"]);
    expect(liveChanges(before, before)).toEqual({ added: [], changed: [], pinned: [], removed: [] });
  });

  it("sums a change up in one short note, or says nothing when nothing visible changed", () => {
    const t = trip();
    expect(changesMessage({ added: ["e", "f"], changed: ["b"], pinned: [], removed: [] }, t, t)).toBe("Trip updated: 2 events added, 1 changed.");
    expect(changesMessage({ added: [], changed: [], pinned: ["c"], removed: [] }, t, t)).toBe("Trip updated: 1 event pinned on the map.");
    expect(changesMessage({ added: [], changed: [], pinned: [], removed: ["d"] }, t, t)).toBe("Trip updated: 1 event removed.");
    expect(changesMessage({ added: ["e"], changed: [], pinned: ["c", "g"], removed: ["d"] }, t, t)).toBe("Trip updated: 1 event added, 2 pinned on the map, 1 removed.");
    const none = { added: [], changed: [], pinned: [], removed: [] };
    expect(changesMessage(none, t, t)).toBeNull();
    expect(changesMessage(none, t, trip({ endDate: "2026-10-25" }))).toBe("Trip updated.");
    expect(changesMessage(none, t, trip({ budget: { amount: "1000", currency: "JPY" } }))).toBe("Trip updated.");
    expect(changesMessage(none, t, trip({ role: "viewer" }))).toBe("You can now only view this trip.");
    expect(changesMessage(none, trip({ role: "viewer" }), trip({ role: "editor" }))).toBe("You can now edit this trip's events.");
    expect(changesMessage(none, trip({ role: "editor" }), trip({ role: "owner" }))).toBe("You are now an owner of this trip.");
  });
});
