import { describe, expect, it } from "vitest";
import type { PlanItemRow } from "@/server/core/db/schema";
import { contentChanged } from "@/server/modules/items/items.rules";

const row = (patch: Partial<PlanItemRow> = {}) =>
  ({
    id: "i1", trip_id: "t1", version: 3, created_at: new Date("2026-10-01T00:00:00Z"), updated_at: new Date("2026-10-02T00:00:00Z"), deleted_at: null,
    source: "ai", reviewed_at: null, person_edited_at: null, is_copy: false, type: "activity", title: "Castle", location: "Lisbon", notes: null,
    links: [{ url: "https://example.com", label: "Site" }], map_url: null, latitude: null, longitude: null, pin_source: null,
    booking_status: "not_required", booking_due_date: null, planned_amount: "40.00", planned_currency: "EUR", price_label: "estimate", price_source: "ai",
    local_date: "2026-11-02", local_time: "09:00:00", ...patch,
  }) as PlanItemRow;

describe("contentChanged", () => {
  it("ignores a write that only moved the version and timestamps", () => {
    expect(contentChanged(row(), row({ version: 4, updated_at: new Date("2026-10-05T00:00:00Z"), person_edited_at: new Date() }))).toBe(false);
  });

  it("sees a changed value, link or provenance", () => {
    expect(contentChanged(row(), row({ title: "Castle tour" }))).toBe(true);
    expect(contentChanged(row(), row({ links: [{ url: "https://example.com", label: "Tickets" }] }))).toBe(true);
    // "I checked this price": the same amount, now the owner's.
    expect(contentChanged(row(), row({ price_source: "owner" }))).toBe(true);
  });
});
