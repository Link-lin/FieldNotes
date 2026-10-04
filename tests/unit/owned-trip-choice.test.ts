import { describe, expect, it } from "vitest";
import type { OwnedTripDTO } from "@/shared/dto";
import { defaultChoice, namesText, toDecision, validChoice } from "@/components/layout/AppHeader/AccountMenu/DeleteAccountDialog/owned-trip-choice";

const trip = (over: Partial<OwnedTripDTO> = {}): OwnedTripDTO => ({ id: "t1", title: "Hawaii", startDate: "2026-10-19", endDate: "2026-10-26", otherOwners: [], people: [], ...over });
const sam = { id: "p-sam", email: "sam@example.com", role: "editor" as const };
const riley = { id: "p-riley", email: "riley@example.com", role: "viewer" as const };

describe("where a trip starts", () => {
  it("stays with its other owners", () => expect(defaultChoice(trip({ otherOwners: ["Jordan"], people: [sam] }))).toBe("keep"));
  it("goes to the next person in line when nobody else owns it", () => expect(defaultChoice(trip({ people: [sam, riley] }))).toBe("p-sam"));
  it("is deleted when nobody else is on it", () => expect(defaultChoice(trip())).toBe("delete"));
});

describe("whether a choice still fits", () => {
  it("accepts deleting any trip", () => {
    expect(validChoice(trip(), "delete")).toBe(true);
    expect(validChoice(trip({ people: [sam] }), "delete")).toBe(true);
  });
  it("accepts keeping only a trip other owners have", () => {
    expect(validChoice(trip({ otherOwners: ["Jordan"] }), "keep")).toBe(true);
    expect(validChoice(trip({ people: [sam] }), "keep")).toBe(false);
  });
  it("accepts a person only while they are on a trip nobody else owns", () => {
    expect(validChoice(trip({ people: [sam] }), "p-sam")).toBe(true);
    expect(validChoice(trip({ people: [riley] }), "p-sam")).toBe(false);
    expect(validChoice(trip({ otherOwners: ["Jordan"], people: [sam] }), "p-sam")).toBe(false);
    expect(validChoice(trip(), undefined)).toBe(false);
  });
});

describe("what is sent", () => {
  it("sends keep for a trip other owners keep, so it is refused rather than deleted if they have gone", () => {
    expect(toDecision(trip({ otherOwners: ["Jordan"] }), "keep")).toEqual({ tripId: "t1", action: "keep" });
  });
  it("sends nothing for a trip nobody else is on", () => {
    expect(toDecision(trip(), "delete")).toBeNull();
  });
  it("sends a delete for a trip that has other people, or other owners", () => {
    expect(toDecision(trip({ people: [sam] }), "delete")).toEqual({ tripId: "t1", action: "delete" });
    expect(toDecision(trip({ otherOwners: ["Jordan"] }), "delete")).toEqual({ tripId: "t1", action: "delete" });
  });
  it("sends a transfer for a chosen person", () => {
    expect(toDecision(trip({ people: [sam, riley] }), "p-riley")).toEqual({ tripId: "t1", action: "transfer", personId: "p-riley" });
  });
});

describe("naming the owners who keep a trip", () => {
  it("joins one, two or many", () => {
    expect(namesText(["Jordan"])).toBe("Jordan");
    expect(namesText(["Jordan", "Sam"])).toBe("Jordan and Sam");
    expect(namesText(["Jordan", "Sam", "Riley"])).toBe("Jordan, Sam and 1 other");
    expect(namesText(["Jordan", "Sam", "Riley", "Eve"])).toBe("Jordan, Sam and 2 others");
  });
});
