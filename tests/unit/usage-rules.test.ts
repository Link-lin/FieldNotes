import { describe, expect, it } from "vitest";
import { summarizeUsage } from "@/server/modules/usage/usage.rules";

describe("pilot report", () => {
  it("totals, rates and Monday-based weeks", () => {
    const s = summarizeUsage([
      { day: "2026-09-28", name: "import_preview_ok", count: 3 },
      { day: "2026-09-29", name: "import_preview_needs_fixes", count: 1 },
      { day: "2026-10-04", name: "import_items_created", count: 18 },
      { day: "2026-10-05", name: "import_items_skipped", count: 2 },
      { day: "2026-10-05", name: "ai_item_edited", count: 9 },
    ]);
    expect(s.totals.import_preview_ok).toBe(3);
    expect(s.totals.item_booked).toBe(0);
    expect(s.rates).toEqual({ cleanPreview: 0.75, rejectedPreview: 0, skippedItems: 0.1, editsPerImportedItem: 0.5 });
    expect(s.weeks.map((w) => w.week)).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("reports no rate without data", () => {
    expect(summarizeUsage([]).rates.cleanPreview).toBeNull();
  });
});
