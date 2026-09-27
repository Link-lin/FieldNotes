import { describe, expect, it } from "vitest";
import { editPreviewItem, editPreviewTrip, hasRemovableEmptySourceValues, removePreviewEmptySourceValues, removePreviewUnknownFields } from "@/features/import/ImportPage/preview-validation";
import { previewImport } from "@/server/modules/import/import.rules";

const trip = { title: "Autumn visit", destination: "New York", startDate: "2027-11-01", endDate: "2027-11-10", timeZone: "America/New_York" };
const response = (item: Record<string, unknown>) => JSON.stringify({ formatVersion: 1, trip, items: [item] });

function preview(item: Record<string, unknown>) {
  const result = previewImport(response(item), null);
  if (!result.ok) throw new Error("Expected an editable preview");
  return result.preview;
}

describe("AI import preview correction", () => {
  it("keeps invalid source links until the owner explicitly removes them", () => {
    const initial = preview({ type: "activity", title: "Walk", bookingStatus: "Not required", links: null });
    expect(initial.items[0]?.values.links).toBeNull();
    expect(initial.items[0]?.errors.some((error) => error.path === "items[0].links")).toBe(true);
    expect(hasRemovableEmptySourceValues(initial.items[0]!, initial.trip.values)).toBe(false);

    const renamed = editPreviewItem(initial, 0, "title", "City walk");
    expect(renamed.items[0]?.errors.some((error) => error.path === "items[0].links")).toBe(true);

    const removed = editPreviewItem(renamed, 0, "links", []);
    expect(removed.items[0]?.errors).toEqual([]);
    expect(removed.items[0]?.values.links).toEqual([]);
  });

  it("offers an explicit omission for optional source nulls that the draft accepts", () => {
    const initial = preview({ type: "activity", title: "Walk", bookingStatus: "Not required", notes: null });
    expect(hasRemovableEmptySourceValues(initial.items[0]!, initial.trip.values)).toBe(true);
    const renamed = editPreviewItem(initial, 0, "title", "City walk");
    expect(renamed.items[0]?.errors.some((error) => error.path === "items[0].notes")).toBe(true);
    const omitted = removePreviewEmptySourceValues(renamed, 0);
    expect(omitted.items[0]?.errors).toEqual([]);

    const flight = preview({ type: "flight", title: "Flight", bookingStatus: "Needs booking", localDate: null, flightDetails: {} });
    expect(hasRemovableEmptySourceValues(flight.items[0]!, flight.trip.values)).toBe(true);
    expect(removePreviewEmptySourceValues(flight, 0).items[0]?.errors).toEqual([]);
  });

  it("keeps an invalid flight endpoint until it is replaced", () => {
    const initial = preview({ type: "flight", title: "Flight", bookingStatus: "Needs booking", flightDetails: { departure: null } });
    expect((initial.items[0]?.values.flightDetails as Record<string, unknown>).departure).toBeNull();
    const renamed = editPreviewItem(initial, 0, "title", "Outbound flight");
    expect(renamed.items[0]?.errors.some((error) => error.path === "items[0].flightDetails.departure")).toBe(true);
    const replaced = editPreviewItem(renamed, 0, "flightDetails.departure", {
      airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null,
    });
    expect(replaced.items[0]?.errors).toEqual([]);
  });

  it("keeps an unresolved repeated time visible and refreshes it when the time changes", () => {
    const initial = preview({ type: "activity", title: "Breakfast", bookingStatus: "Not required", localDate: "2027-11-07", localTime: "01:30" });
    const renamed = editPreviewItem(initial, 0, "title", "Early breakfast");
    expect(renamed.items[0]?.errors.some((error) => error.path === "items[0].timeDisambiguation")).toBe(true);
    const moved = editPreviewItem(renamed, 0, "localTime", "03:30");
    expect(moved.items[0]?.errors).toEqual([]);
  });

  it("recomputes inherited local times after changing the trip time zone", () => {
    const initial = preview({ type: "activity", title: "Breakfast", bookingStatus: "Not required", localDate: "2027-11-07", localTime: "01:30" });
    const changed = editPreviewTrip(initial, "timeZone", "Asia/Tokyo");
    expect(changed.items[0]?.errors).toEqual([]);
  });

  it("requires an explicit action to remove unsupported fields", () => {
    const initial = preview({ type: "activity", title: "Walk", bookingStatus: "Not required", unsupported: "text" });
    const renamed = editPreviewItem(initial, 0, "title", "City walk");
    expect(renamed.items[0]?.errors.some((error) => error.code === "unknown_field")).toBe(true);
    const removed = removePreviewUnknownFields(renamed, 0);
    expect(removed.items[0]?.errors).toEqual([]);
  });
});
