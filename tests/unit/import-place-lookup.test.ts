import { describe, expect, it } from "vitest";
import { finishLookup, lookupMatches, needsLookup, settleLookups, type PlaceLookup } from "@/features/import/ImportPage/place-lookup";

const entry: PlaceLookup = { location: "Twin Falls, Maui, Hawaii", destination: "Hawaii", requestId: 2, status: "loading", candidates: [], selected: null, reviewed: false };
const result = { candidates: [{ label: "Twin Falls", latitude: 20.91, longitude: -156.24, confidence: 1, kind: "amenity" }], suggestedIndex: 0 };

describe("import place selection", () => {
  it("keeps valid suggestions visible and eligible for commit with surrounding whitespace", () => {
    expect(lookupMatches(entry, " Twin Falls, Maui, Hawaii ", " Hawaii ")).toBe(true);
  });
  it("ignores late responses after a new request or a deleted lookup", () => {
    expect(finishLookup(entry, 1, result)).toBe(entry);
    expect(finishLookup(undefined, 2, result)).toBeUndefined();
    expect(finishLookup(entry, 2, result)).toMatchObject({ status: "ready", selected: 0 });
  });
  it("settles excluded rows when a refresh supersedes their pending requests", () => {
    const ready = { ...entry, status: "ready" as const, reviewed: true };
    const settled = settleLookups({ 0: entry, 1: ready });
    expect(settled[0]?.status).toBe("error");
    expect(settled[1]).toBe(ready);
  });
  it("refresh preserves a chosen match and explicit Do not pin for unchanged places", () => {
    for (const selected of [0, null]) {
      const reviewed = { ...entry, status: "ready" as const, reviewed: true, selected };
      expect(needsLookup(reviewed, entry.location, entry.destination)).toBe(false);
      expect(needsLookup(reviewed, "Rainbow Falls", entry.destination)).toBe(true);
    }
    expect(needsLookup(entry, entry.location, entry.destination)).toBe(true);
  });
});
