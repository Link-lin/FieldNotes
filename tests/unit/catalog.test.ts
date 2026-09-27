import { describe, expect, it } from "vitest";
import { matchDestination, searchPlaces } from "@/server/modules/places/catalog";

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
  it("ranks prominent places first and carries their time zones", () => {
    expect(searchPlaces("par")[0]!.label).toBe("Paris, France");
    const kyoto = searchPlaces("kyoto")[0]!;
    expect(kyoto).toMatchObject({ label: "Kyoto, Japan", kind: "city", timeZones: ["Asia/Tokyo"] });
    expect(searchPlaces("japan").find((p) => p.kind === "country")?.timeZones).toEqual(["Asia/Tokyo"]);
    const usa = searchPlaces("united states of").find((p) => p.kind === "country")!;
    expect(usa.timeZones[0]).toBe("America/New_York");
    expect(usa.timeZones).toContain("America/Los_Angeles");
  });
  it("corrects known bad zones in the source data", () => {
    expect(searchPlaces("cardiff")[0]!.timeZones).toEqual(["Europe/London"]);
    expect(searchPlaces("santo domingo")[0]!.timeZones).toEqual(["America/Santo_Domingo"]);
  });
});
