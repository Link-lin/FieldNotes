/**
 * Pilot measures (PRD: Validation and MVP acceptance). Each name is a daily total with no user, trip or content
 * attached. Keep names short, lower_snake_case and stable: the report reads them by name.
 */
export const USAGE_NAMES = [
  "import_preview_ok", // a pasted response previewed with no errors
  "import_preview_needs_fixes", // previewed, but with trip or item errors to fix or skip
  "import_preview_rejected", // malformed JSON, wrong version or unreadable structure
  "import_trip_created", // a confirmed import created a trip (retries not counted)
  "import_items_created",
  "import_items_skipped", // items the owner skipped in the preview
  "ai_item_edited", // an owner edit (or notes save) on an imported item
  "ai_item_deleted",
  "manual_trip_created",
  "manual_item_created",
  "due_date_set", // a book-by date added or changed
  "item_booked", // an item marked Booked
] as const;

export type UsageName = (typeof USAGE_NAMES)[number];
export type UsageEvent = { name: UsageName; count?: number };

export type UsageRow = { day: string; name: string; count: number };

/** Totals per name for the whole pilot and per ISO week (weeks start on Monday). */
export function summarizeUsage(rows: UsageRow[]) {
  const totals = new Map<string, number>();
  const weeks = new Map<string, Map<string, number>>();
  for (const r of rows) {
    totals.set(r.name, (totals.get(r.name) ?? 0) + r.count);
    const week = weekStart(r.day);
    const w = weeks.get(week) ?? new Map<string, number>();
    w.set(r.name, (w.get(r.name) ?? 0) + r.count);
    weeks.set(week, w);
  }
  const t = (n: UsageName) => totals.get(n) ?? 0;
  const previews = t("import_preview_ok") + t("import_preview_needs_fixes") + t("import_preview_rejected");
  const reviewed = t("import_items_created") + t("import_items_skipped");
  return {
    totals: Object.fromEntries(USAGE_NAMES.map((n) => [n, t(n)])) as Record<UsageName, number>,
    weeks: [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, w]) => ({ week, counts: Object.fromEntries(w) })),
    rates: {
      /** Previews that needed no fixing, of all previews. */
      cleanPreview: ratio(t("import_preview_ok"), previews),
      /** Previews rejected before a preview could be shown (malformed or unsupported JSON). */
      rejectedPreview: ratio(t("import_preview_rejected"), previews),
      /** Items skipped in preview, of all items reviewed in confirmed imports. */
      skippedItems: ratio(t("import_items_skipped"), reviewed),
      /** Owner edits to imported items per imported item (an item can be edited more than once). */
      editsPerImportedItem: ratio(t("ai_item_edited"), t("import_items_created")),
    },
  };
}

function ratio(a: number, b: number): number | null {
  return b ? Math.round((a / b) * 1000) / 1000 : null;
}

function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
