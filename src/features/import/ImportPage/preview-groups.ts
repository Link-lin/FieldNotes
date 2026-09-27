import type { ImportPreviewDTO } from "@/shared/import";
import { isDate, isLocalDateTime, isTime, isTimeZone, resolveLocal } from "@/shared/time";
import { fmtDay } from "@/lib/format";

type Row = ImportPreviewDTO["items"][number];
export type PreviewGroup = { key: string; label: string; timed: Row[]; unscheduled: Row[] };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === "string" && value ? value : null;

function placement(row: Row, tripZone: string | null): { key: string; timedAt: number | null } {
  const values = row.values;
  if (values.type === "flight") {
    const details = record(values.flightDetails);
    const departure = record(details.departure);
    const exact = string(departure.localDateTime);
    if (exact) {
      if (!isLocalDateTime(exact)) return { key: "needs-correction", timedAt: null };
      const zone = string(departure.timeZone);
      const choice = departure.timeDisambiguation === "earlier" || departure.timeDisambiguation === "later" ? departure.timeDisambiguation : null;
      const instant = zone && isTimeZone(zone) ? resolveLocal(exact.slice(0, 10), exact.slice(11), zone, choice) : null;
      return { key: exact.slice(0, 10), timedAt: instant?.ok ? instant.epochMs : null };
    }
    const planned = string(details.plannedDepartureDate);
    if (planned) return { key: isDate(planned) ? planned : "needs-correction", timedAt: null };
    return { key: "undated-flights", timedAt: null };
  }
  const date = string(values.localDate);
  if (!date) return { key: "undated", timedAt: null };
  if (!isDate(date)) return { key: "needs-correction", timedAt: null };
  const time = string(values.localTime);
  const zone = string(values.timeZone) ?? tripZone;
  const choice = values.timeDisambiguation === "earlier" || values.timeDisambiguation === "later" ? values.timeDisambiguation : null;
  const instant = time && isTime(time) && zone && isTimeZone(zone) ? resolveLocal(date, time, zone, choice) : null;
  return { key: date, timedAt: instant?.ok ? instant.epochMs : null };
}

/** Live grouping for the unsaved import preview. Invalid dates stay visible in a correction section. */
export function groupPreviewItems(rows: Row[], tripZone: string | null): PreviewGroup[] {
  const groups = new Map<string, { timed: Array<{ row: Row; at: number }>; unscheduled: Row[] }>();
  for (const row of rows) {
    const { key, timedAt } = placement(row, tripZone);
    const group = groups.get(key) ?? { timed: [], unscheduled: [] };
    if (timedAt === null) group.unscheduled.push(row);
    else group.timed.push({ row, at: timedAt });
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const rank = (key: string) => key === "undated-flights" ? 1 : key === "undated" ? 2 : key === "needs-correction" ? 3 : 0;
    return rank(a) - rank(b) || (rank(a) === 0 ? a.localeCompare(b) : 0);
  });
  return keys.map((key) => {
    const group = groups.get(key)!;
    group.timed.sort((a, b) => a.at - b.at || a.row.index - b.row.index);
    group.unscheduled.sort((a, b) => a.index - b.index);
    return { key, label: key === "undated-flights" ? "Undated flights" : key === "undated" ? "Undated" : key === "needs-correction" ? "Needs date correction" : `${fmtDay(key)} · ${key}`,
      timed: group.timed.map(({ row }) => row), unscheduled: group.unscheduled };
  });
}
