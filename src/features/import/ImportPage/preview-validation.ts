import type { FieldError } from "@/shared/dto";
import { importCommitSchema, tripDraftSchema, type ImportPreviewDTO } from "@/shared/import";

type ItemRow = ImportPreviewDTO["items"][number];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function setPath(values: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const next = { ...values };
  let part = next;
  for (const key of keys.slice(0, -1)) {
    part[key] = { ...asRecord(part[key]) };
    part = part[key] as Record<string, unknown>;
  }
  part[keys[keys.length - 1]!] = value;
  return next;
}

function valueAt(values: Record<string, unknown>, path: string): unknown {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").reduce<unknown>((part, key) => asRecord(part)[key], values);
}

function fieldErrors(issues: Array<{ path: PropertyKey[]; code: string; message: string }>, prefix: string): FieldError[] {
  return issues.map((issue) => ({
    path: issue.path.reduce<string>((path, part) => typeof part === "number" ? `${path}[${part}]` : `${path}.${String(part)}`, prefix),
    code: issue.code === "custom" ? "invalid" : issue.code,
    message: issue.message,
  }));
}

function draftErrors(row: ItemRow, trip: ImportPreviewDTO["trip"]["values"]): FieldError[] {
  const checked = importCommitSchema.safeParse({
    expectedFormatVersion: 1,
    ownerProvidedBudget: trip.budget ?? null,
    trip,
    items: [row.values],
  });
  if (checked.success) return [];
  const issues = checked.error.issues.filter((issue) => issue.path[0] === "items" && issue.path[1] === 0)
    .map((issue) => ({ ...issue, path: issue.path.slice(2) }));
  return fieldErrors(issues, `items[${row.index}]`);
}

function withDraftErrors(row: ItemRow, trip: ImportPreviewDTO["trip"]["values"]): ItemRow {
  const seen = new Set<string>();
  const errors = [...row.sourceErrors, ...draftErrors(row, trip)].filter((error) => {
    if (seen.has(error.path)) return false;
    seen.add(error.path);
    return true;
  });
  return { ...row, errors };
}

/** A null source value can be explicitly omitted when the normalized draft accepts that null. */
function removableEmptySourceErrors(row: ItemRow, trip: ImportPreviewDTO["trip"]["values"]): FieldError[] {
  if (!row.sourceErrors.length) return [];
  const draft = draftErrors(row, trip);
  const prefix = `items[${row.index}].`;
  return row.sourceErrors.filter((error) => {
    if (error.code === "unknown_field" || !error.path.startsWith(prefix)) return false;
    const path = error.path.slice(prefix.length);
    return valueAt(row.values, path) === null && !draft.some((issue) => issue.path === error.path);
  });
}

export function hasRemovableEmptySourceValues(row: ItemRow, trip: ImportPreviewDTO["trip"]["values"]): boolean {
  return removableEmptySourceErrors(row, trip).length > 0;
}

function addressedByEdit(error: FieldError, index: number, path: string): boolean {
  if (error.code === "unknown_field") return false; // Explicit removal or skip is required.
  const full = `items[${index}].${path}`;
  if (error.path === full || error.path.startsWith(`${full}.`) || error.path.startsWith(`${full}[`) ||
      full.startsWith(`${error.path}.`) || full.startsWith(`${error.path}[`)) return true;
  // These source errors describe a relationship; editing either side can resolve it.
  const relative = error.path.replace(`items[${index}].`, "");
  if (relative === "localDate" && path === "localTime") return true;
  if (relative === "bookingStatus" && path === "type") return true;
  if (relative === "flightDetails" && path === "type") return true;
  if (relative === "flightDetails.plannedDepartureDate" && path === "flightDetails.departure.localDateTime") return true;
  if (/^flightDetails\.(departure|arrival)\.timeZone$/.test(relative) && path === relative.replace(/timeZone$/, "localDateTime")) return true;
  return false;
}

/** Keep source-contract errors until their own field is edited; refresh draft/DST errors live. */
export function editPreviewItem(preview: ImportPreviewDTO, index: number, path: string, value: unknown): ImportPreviewDTO {
  return { ...preview, items: preview.items.map((row) => {
    if (row.index !== index) return row;
    const next = {
      ...row,
      values: setPath(row.values, path, value),
      sourceErrors: row.sourceErrors.filter((error) => !addressedByEdit(error, index, path)),
    };
    return withDraftErrors(next, preview.trip.values);
  }) };
}

export function editPreviewTrip(preview: ImportPreviewDTO, path: string, value: unknown): ImportPreviewDTO {
  const values = setPath(preview.trip.values, path, value);
  const checked = tripDraftSchema.safeParse(values);
  const tripBecameValid = !tripDraftSchema.safeParse(preview.trip.values).success && checked.success;
  return {
    ...preview,
    trip: { ...preview.trip, values, errors: checked.success ? [] : fieldErrors(checked.error.issues, "trip") },
    items: path === "timeZone" || tripBecameValid ? preview.items.map((row) => withDraftErrors(row, values)) : preview.items,
  };
}

export function removePreviewUnknownFields(preview: ImportPreviewDTO, index: number): ImportPreviewDTO {
  return { ...preview, items: preview.items.map((row) => row.index === index ? withDraftErrors({
    ...row,
    sourceErrors: row.sourceErrors.filter((error) => error.code !== "unknown_field"),
  }, preview.trip.values) : row) };
}

export function removePreviewEmptySourceValues(preview: ImportPreviewDTO, index: number): ImportPreviewDTO {
  return { ...preview, items: preview.items.map((row) => {
    if (row.index !== index) return row;
    const removable = new Set(removableEmptySourceErrors(row, preview.trip.values));
    return withDraftErrors({ ...row, sourceErrors: row.sourceErrors.filter((error) => !removable.has(error)) }, preview.trip.values);
  }) };
}
