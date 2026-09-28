import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewImport, validateImportCommit } from "@/server/modules/import/import.rules";
import type { PlanItemDraftDTO, TripDraftDTO } from "@/shared/import";

const trip = { title: "Tokyo visit", destination: "Tokyo, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo" };
const source = (items: unknown[] = [], extra: Record<string, unknown> = {}) => JSON.stringify({ formatVersion: 1, trip, items, ...extra });
const item = (extra: Record<string, unknown> = {}) => ({ type: "activity", title: "Walk", bookingStatus: "Not required", ...extra });
const budget = { amount: "1200.00", currency: "USD" };

function preview(text: string, ownerBudget: typeof budget | null = null) {
  const result = previewImport(text, ownerBudget);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a preview");
  return result.preview;
}

describe("external AI import preview", () => {
  it("parses the published fixture and keeps the owner's budget authoritative", () => {
    const fixture = readFileSync("docs/design/import-example-v1.json", "utf8");
    const result = preview(fixture, budget);
    expect(result.trip.values.budget).toEqual(budget);
    expect(result.trip.errors).toEqual([]);
    expect(result.trip.warnings).toEqual([]);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((i) => i.errors.length === 0)).toBe(true);
    expect(result.items[0]!.values.bookingStatus).toBe("needs_booking");
    expect(result.items[0]!.values.flightDetails).toMatchObject({ plannedDepartureDate: "2027-04-14" });
    expect(result.items[1]!.values.plannedPrice).toEqual({ amount: "540.00", currency: "USD" });
  });

  it("accepts one plain or fenced JSON object but rejects surrounding prose", () => {
    const json = source([item()]);
    expect(preview(`\n${json}\n`).items).toHaveLength(1);
    expect(preview(`\`\`\`json\n${json}\n\`\`\``).items).toHaveLength(1);
    const result = previewImport(`Here is your trip:\n${json}`, null);
    expect(result).toMatchObject({ ok: false, code: "malformed_json" });
  });

  it("rejects malformed JSON, duplicate decoded keys, unsupported versions and bad top-level shapes", () => {
    expect(previewImport("{", null)).toMatchObject({ ok: false, code: "malformed_json" });
    expect(previewImport(source([], { formatVersion: 2 }), null)).toMatchObject({ ok: false, code: "unsupported_version" });
    expect(previewImport("[]", null)).toMatchObject({ ok: false, code: "invalid_structure" });
    const repeated = `{"formatVersion":1,"trip":${JSON.stringify(trip)},"items":[{"type":"activity","title":"Walk","bookingStatus":"Not required","title":"Again"}]}`;
    const result = previewImport(repeated, null);
    expect(result).toMatchObject({ ok: false, code: "malformed_json" });
    if (!result.ok) expect(result.errors[0]!.path).toBe("items[0].title");
    const escaped = `{"formatVersion":1,"trip":${JSON.stringify(trip)},"items":[],"it\\u0065ms":[]}`;
    expect(previewImport(escaped, null)).toMatchObject({ ok: false, code: "malformed_json" });
  });

  it("reports unknown root/trip fields and retains item-level unknown errors for explicit skip", () => {
    expect(previewImport(source([], { extra: 1 }), null)).toMatchObject({ ok: false, code: "unknown_field" });
    const tripUnknown = JSON.stringify({ formatVersion: 1, trip: { ...trip, extra: 1 }, items: [] });
    expect(previewImport(tripUnknown, null)).toMatchObject({ ok: false, code: "unknown_field" });
    const result = preview(source([item({ extra: "not supported" })]));
    expect(result.items[0]!.included).toBe(true);
    expect(result.items[0]!.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: "items[0].extra", code: "unknown_field" })]));
    expect(result.items[0]!.values).not.toHaveProperty("extra");
  });

  it("shows field errors without dropping bad values or writing a partial trip", () => {
    const result = preview(source([
      item({ localDate: "2027-02-30", localTime: "28:00", plannedPrice: { amount: "9.99", currency: "ZZZ" }, links: [{ label: "Bad", url: "javascript:alert(1)" }] }),
      item({ localDate: null }),
    ]));
    const paths = result.items[0]!.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["items[0].localDate", "items[0].localTime", "items[0].plannedPrice.currency", "items[0].links[0].url"]));
    expect(result.items[0]!.values.localDate).toBe("2027-02-30");
    expect(result.items[1]!.errors.map((e) => e.path)).toContain("items[1].localDate");
    expect(result.items[1]!.values.localDate).toBeNull();
  });

  it("keeps the owner budget and warns when the AI omitted or changed it", () => {
    const omitted = preview(source(), budget);
    expect(omitted.trip.values.budget).toEqual(budget);
    expect(omitted.trip.warnings[0]?.code).toBe("missing_ai_budget");
    expect(omitted.trip.aiBudget).toBeNull();
    const changed = preview(JSON.stringify({ formatVersion: 1, trip: { ...trip, budget: { amount: "900", currency: "USD" } }, items: [] }), budget);
    expect(changed.trip.values.budget).toEqual(budget);
    expect(changed.trip.warnings[0]?.code).toBe("changed_ai_budget");
    expect(changed.trip.aiBudget).toEqual({ amount: "900", currency: "USD" });
    const invented = preview(JSON.stringify({ formatVersion: 1, trip: { ...trip, budget }, items: [] }));
    expect(invented.trip.values.budget).toBeNull();
    expect(invented.trip.warnings[0]?.code).toBe("ignored_ai_budget");
    expect(invented.trip.aiBudget).toEqual({ amount: "1200", currency: "USD" });
    const unreadable = preview(JSON.stringify({ formatVersion: 1, trip: { ...trip, budget: { amount: 900, currency: "USD" } }, items: [] }), budget);
    expect(unreadable.trip.aiBudget).toBeNull();
  });

  it("rejects Booked, extra schedule fields on a flight, and invalid endpoint pairing", () => {
    const result = preview(source([
      { type: "flight", title: "Departure", bookingStatus: "Booked", flightDetails: {} },
      { type: "flight", title: "Return", bookingStatus: "Needs booking", localDate: "2027-04-18", flightDetails: { departure: { localDateTime: "2027-04-18T11:00" } } },
    ]));
    expect(result.items[0]!.errors.map((e) => e.path)).toContain("items[0].bookingStatus");
    expect(result.items[1]!.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["items[1].localDate", "items[1].flightDetails.departure.timeZone"]));
  });

  it("requires owner disambiguation for repeated times and rejects daylight-saving gaps", () => {
    const nyTrip = { ...trip, startDate: "2027-03-01", endDate: "2027-11-30", timeZone: "America/New_York" };
    const result = preview(JSON.stringify({ formatVersion: 1, trip: nyTrip, items: [
      item({ localDate: "2027-03-14", localTime: "02:30" }),
      item({ localDate: "2027-11-07", localTime: "01:30" }),
    ] }));
    expect(result.items[0]!.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "nonexistent_local_time" })]));
    expect(result.items[1]!.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ambiguous_local_time" })]));
  });

  it("rejects impossible flight order and more than 250 items", () => {
    const result = preview(source([{ type: "flight", title: "Flight", bookingStatus: "Needs booking", flightDetails: {
      departure: { localDateTime: "2027-04-14T12:00", timeZone: "Asia/Tokyo" },
      arrival: { localDateTime: "2027-04-14T11:00", timeZone: "Asia/Tokyo" },
    } }]));
    expect(result.items[0]!.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "arrival_before_departure" })]));
    expect(previewImport(source(Array.from({ length: 251 }, () => item())), null)).toMatchObject({ ok: false, code: "too_many_items" });
  });
});

describe("normalized import commit", () => {
  const validTrip: TripDraftDTO = { ...trip, budget: null };
  const validItem: PlanItemDraftDTO = {
    type: "activity", title: "Walk", location: null, notes: null, links: [], bookingStatus: "not_required", bookingDueDate: null,
    plannedPrice: null, localDate: "2027-04-14", localTime: "10:00", timeZone: null, durationMinutes: null,
    timeDisambiguation: null, flightDetails: null,
  };

  it("accepts a complete owner-approved draft and rejects server-owned fields or Booked", () => {
    const input = { expectedFormatVersion: 1, ownerProvidedBudget: null, trip: validTrip, items: [validItem] };
    expect(validateImportCommit(input).success).toBe(true);
    expect(validateImportCommit({ ...input, items: [{ ...validItem, source: "manual" }] }).success).toBe(false);
    expect(validateImportCommit({ ...input, items: [{ ...validItem, bookingStatus: "booked" }] }).success).toBe(false);
    expect(validateImportCommit({ ...input, trip: { ...validTrip, budget } }).success).toBe(false);
  });
});
