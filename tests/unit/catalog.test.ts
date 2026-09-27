import { describe, expect, it } from "vitest";
import { matchDestination, searchPlaces } from "@/server/catalog";

describe("destination matching (ATLAS-3)", () => {
  it("matches exact city, country pairs and country names", () => {
    expect(matchDestination("Tokyo, Japan")).not.toBeNull();
    expect(matchDestination("  lisbon,   PORTUGAL ")).not.toBeNull();
    expect(matchDestination("New York, United States")).not.toBeNull();
    expect(matchDestination("Japan")).not.toBeNull();
  });
  it("never guesses from partial or mismatched names", () => {
    expect(matchDestination("Lis")).toBeNull();
    expect(matchDestination("Tokyo, Texas")).toBeNull();
    expect(matchDestination("Torres del Paine and Ushuaia")).toBeNull();
    expect(matchDestination("")).toBeNull();
  });
  it("searches the bundled catalog only", () => {
    const r = searchPlaces("ushu");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.label).toMatch(/Ushuaia/);
    expect(searchPlaces("u")).toEqual([]);
  });
});
