import "server-only";
import { parseTree, type Node, type ParseError, type ParseOptions } from "jsonc-parser";
import { z } from "zod";
import type { FieldError, MoneyDTO } from "@/shared/dto";
import { importCommitSchema, importMoneySchema, planItemDraftSchema, tripDraftSchema, type ImportPreviewDTO, type PlanItemDraftDTO, type PreviewImportResult } from "@/shared/import";
import { trimAmount } from "@/shared/money";
import { isDate, isLocalDateTime, isTimeZone, resolveLocal } from "@/shared/time";
import { isCurrencyCode } from "@/shared/currencies";
import { parseWebUrl } from "@/shared/map-links";

const ROOT_KEYS = new Set(["formatVersion", "trip", "items"]);
const TRIP_KEYS = new Set(["title", "destination", "startDate", "endDate", "timeZone", "budget"]);
const ITEM_KEYS = new Set(["type", "title", "bookingStatus", "location", "notes", "links", "plannedPrice", "localDate", "localTime", "timeZone", "durationMinutes", "flightDetails"]);
const MONEY_KEYS = new Set(["amount", "currency"]);
const LINK_KEYS = new Set(["label", "url"]);
const FLIGHT_KEYS = new Set(["plannedDepartureDate", "airline", "flightNumber", "departure", "arrival"]);
const ENDPOINT_KEYS = new Set(["airportCode", "localDateTime", "timeZone"]);

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const field = (path: string, code: string, message: string): FieldError => ({ path, code, message });
const pathOf = (base: string, key: string) => base ? `${base}.${key}` : key;

// JSON v1 source fields are optional when unknown, but explicit nulls are not JSON v1.
// Draft/commit fields below deliberately use nulls so guided editing has a stable shape.
const sourceDate = z.string().refine(isDate, "Enter a real date (YYYY-MM-DD).");
const sourceZone = z.string().refine(isTimeZone, "Enter a valid IANA time zone.");
const sourceLocalDateTime = z.string().refine(isLocalDateTime, "Enter a real local date and time (YYYY-MM-DDTHH:mm).");
const sourceEndpoint = z.object({
  airportCode: z.string().regex(/^[A-Z0-9]{3,4}$/).optional(),
  localDateTime: sourceLocalDateTime.optional(),
  timeZone: sourceZone.optional(),
}).strict().superRefine((endpoint, ctx) => {
  if (endpoint.localDateTime && !endpoint.timeZone) ctx.addIssue({ code: "custom", path: ["timeZone"], message: "Add the airport's time zone." });
});
const sourceFlight = z.object({
  plannedDepartureDate: sourceDate.optional(),
  airline: z.string().max(120).optional(),
  flightNumber: z.string().max(24).optional(),
  departure: sourceEndpoint.optional(),
  arrival: sourceEndpoint.optional(),
}).strict().superRefine((flight, ctx) => {
  if (flight.plannedDepartureDate && flight.departure?.localDateTime) ctx.addIssue({ code: "custom", path: ["plannedDepartureDate"], message: "Use the exact departure time instead of a fallback date." });
});
const sourceLink = z.object({
  label: z.string().min(1).max(80),
  url: z.string().max(2048).refine((url) => parseWebUrl(url) !== null, "Use a full http or https link without user information."),
}).strict();
const sourceMoney = z.object({
  amount: z.string().regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/, "Use a nonnegative decimal string with up to four decimal places."),
  currency: z.string().refine(isCurrencyCode, "Use a supported ISO 4217 currency code."),
}).strict();
const sourceItemSchema = z.object({
  type: z.enum(["flight", "lodging", "transport", "meal", "activity", "other"]),
  title: z.string().min(1).max(200),
  bookingStatus: z.enum(["Needs booking", "Not required"]),
  location: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  links: z.array(sourceLink).max(20).optional(),
  plannedPrice: sourceMoney.optional(),
  localDate: sourceDate.optional(),
  localTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  timeZone: sourceZone.optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  flightDetails: sourceFlight.optional(),
}).strict().superRefine((item, ctx) => {
  if (item.type === "flight") {
    if (!item.flightDetails) ctx.addIssue({ code: "custom", path: ["flightDetails"], message: "Add flightDetails, even when it is empty." });
    if (item.bookingStatus !== "Needs booking") ctx.addIssue({ code: "custom", path: ["bookingStatus"], message: "Imported flights must need booking." });
    for (const key of ["localDate", "localTime", "timeZone", "durationMinutes"] as const) {
      if (key in item) ctx.addIssue({ code: "custom", path: [key], message: "Flights use flightDetails instead of general schedule fields." });
    }
  } else {
    if (item.flightDetails !== undefined) ctx.addIssue({ code: "custom", path: ["flightDetails"], message: "Only flights can have flightDetails." });
    if (item.localTime && !item.localDate) ctx.addIssue({ code: "custom", path: ["localDate"], message: "A time needs a date." });
  }
});

function uniqueErrors(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    if (seen.has(error.path)) return false;
    seen.add(error.path);
    return true;
  });
}

function zodErrors(error: z.ZodError, prefix = ""): FieldError[] {
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    const path = issue.path.reduce<string>((acc, bit) => typeof bit === "number" ? `${acc}[${bit}]` : pathOf(acc, String(bit)), prefix);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out.push(field(pathOf(path, key), "unknown_field", `The JSON contains an unsupported field: ${key}.`));
    } else {
      out.push(field(path, issue.code === "custom" ? "invalid" : issue.code, issue.message));
    }
  }
  return out;
}

function unknownKeys(value: JsonObject, keys: Set<string>, path: string): FieldError[] {
  return Object.keys(value).filter((key) => !keys.has(key)).map((key) => field(pathOf(path, key), "unknown_field", `The JSON contains an unsupported field: ${key}. Remove it or ask the AI to return JSON v1.`));
}

function nestedUnknowns(value: unknown, keys: Set<string>, path: string): FieldError[] {
  return object(value) ? unknownKeys(value, keys, path) : [];
}

/** Preserve known fields and invalid values so the owner can correct them in a form. */
function pick(value: JsonObject, keys: Set<string>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)));
}

function itemUnknowns(value: JsonObject, path: string): FieldError[] {
  const errors = unknownKeys(value, ITEM_KEYS, path);
  errors.push(...nestedUnknowns(value.plannedPrice, MONEY_KEYS, `${path}.plannedPrice`));
  if (Array.isArray(value.links)) value.links.forEach((link, i) => errors.push(...nestedUnknowns(link, LINK_KEYS, `${path}.links[${i}]`)));
  if (object(value.flightDetails)) {
    errors.push(...unknownKeys(value.flightDetails, FLIGHT_KEYS, `${path}.flightDetails`));
    errors.push(...nestedUnknowns(value.flightDetails.departure, ENDPOINT_KEYS, `${path}.flightDetails.departure`));
    errors.push(...nestedUnknowns(value.flightDetails.arrival, ENDPOINT_KEYS, `${path}.flightDetails.arrival`));
  }
  return errors;
}

function pickedItem(value: JsonObject): Partial<Record<keyof PlanItemDraftDTO, unknown>> {
  const out = pick(value, ITEM_KEYS);
  if (object(out.plannedPrice)) out.plannedPrice = pick(out.plannedPrice, MONEY_KEYS);
  if (Array.isArray(out.links)) out.links = out.links.map((link) => object(link) ? pick(link, LINK_KEYS) : link);
  if (object(out.flightDetails)) {
    const details = pick(out.flightDetails, FLIGHT_KEYS);
    if (object(details.departure)) details.departure = pick(details.departure, ENDPOINT_KEYS);
    if (object(details.arrival)) details.arrival = pick(details.arrival, ENDPOINT_KEYS);
    out.flightDetails = details;
  }
  // Source values use title-case labels; drafts and commit use stable internal values.
  if (out.bookingStatus === "Needs booking") out.bookingStatus = "needs_booking";
  else if (out.bookingStatus === "Not required") out.bookingStatus = "not_required";
  return out;
}

function normalizedItem(value: JsonObject): Partial<Record<keyof PlanItemDraftDTO, unknown>> {
  const out = pickedItem(value);
  for (const key of ["location", "notes", "plannedPrice", "localDate", "localTime", "timeZone", "durationMinutes", "flightDetails"] as const) {
    if (!(key in out)) out[key] = null;
  }
  if (out.links === undefined) out.links = [];
  out.bookingDueDate = null;
  out.timeDisambiguation = null;
  if (object(out.flightDetails)) {
    const details = out.flightDetails;
    for (const key of ["plannedDepartureDate", "airline", "flightNumber"] as const) details[key] ??= null;
    for (const side of ["departure", "arrival"] as const) {
      if (details[side] === undefined) details[side] = {};
      if (object(details[side])) {
        for (const key of ["airportCode", "localDateTime", "timeZone"] as const) details[side][key] ??= null;
        details[side].timeDisambiguation = null;
      }
    }
  }
  return out;
}

/** Detect duplicate decoded property names at every object depth before JSON.parse can discard one. */
function duplicateKeys(node: Node | undefined, path = ""): FieldError[] {
  if (!node) return [];
  const errors: FieldError[] = [];
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = String(property.children?.[0]?.value ?? "");
      const childPath = pathOf(path, key);
      if (seen.has(key)) errors.push(field(childPath, "duplicate_key", `The JSON repeats the field ${key}. Ask the AI to return it once.`));
      seen.add(key);
      errors.push(...duplicateKeys(property.children?.[1], childPath));
    }
  } else if (node.type === "array") {
    node.children?.forEach((child, i) => errors.push(...duplicateKeys(child, `${path}[${i}]`)));
  }
  return errors;
}

function jsonText(responseText: string): string {
  const trimmed = responseText.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

function parsedResponse(responseText: string): { value: unknown; errors: FieldError[] } {
  const source = jsonText(responseText);
  const diagnostics: ParseError[] = [];
  const options: ParseOptions = { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false };
  const tree = parseTree(source, diagnostics, options);
  if (!tree || diagnostics.length) return { value: null, errors: [field("responseText", "malformed_json", "Paste one JSON object, with no comments, trailing commas, or text around it.")] };
  const duplicateErrors = duplicateKeys(tree);
  if (duplicateErrors.length) return { value: null, errors: duplicateErrors };
  try {
    return { value: JSON.parse(source) as unknown, errors: [] };
  } catch {
    return { value: null, errors: [field("responseText", "malformed_json", "Paste one valid JSON object.")] };
  }
}

function budgetWarning(aiBudget: unknown, ownerBudget: MoneyDTO | null): FieldError | null {
  if (ownerBudget === null) {
    return aiBudget === undefined ? null : field("trip.budget", "ignored_ai_budget", "The AI supplied a budget you did not enter. It isn't used unless you choose it; you can also set one yourself.");
  }
  if (aiBudget === undefined) return field("trip.budget", "missing_ai_budget", "The AI omitted your budget. Your original budget was kept.");
  const parsed = importMoneySchema.safeParse(aiBudget);
  if (!parsed.success || parsed.data.currency !== ownerBudget.currency || trimAmount(parsed.data.amount) !== trimAmount(ownerBudget.amount)) {
    return field("trip.budget", "changed_ai_budget", "The AI changed your budget. Your original budget is kept unless you choose the AI's.");
  }
  return null;
}

function itemSemanticErrors(item: PlanItemDraftDTO, tripZone: string, prefix: string): FieldError[] {
  const errors: FieldError[] = [];
  const local = (dateTime: string, zone: string, choice: "earlier" | "later" | null, path: string): number | null => {
    const result = resolveLocal(dateTime.slice(0, 10), dateTime.slice(11), zone, choice);
    if (result.ok) return result.epochMs;
    errors.push(field(`${prefix}.${path}.${result.reason === "ambiguous" ? "timeDisambiguation" : "localDateTime"}`, result.reason === "gap" ? "nonexistent_local_time" : "ambiguous_local_time", result.reason === "gap" ? "This local time does not exist in that time zone." : "Choose the earlier or later occurrence of this local time."));
    return null;
  };
  if (item.type === "flight" && item.flightDetails) {
    const dep = item.flightDetails.departure;
    const arr = item.flightDetails.arrival;
    const departure = dep.localDateTime && dep.timeZone ? local(dep.localDateTime, dep.timeZone, dep.timeDisambiguation, "flightDetails.departure") : null;
    const arrival = arr.localDateTime && arr.timeZone ? local(arr.localDateTime, arr.timeZone, arr.timeDisambiguation, "flightDetails.arrival") : null;
    if (departure !== null && arrival !== null && arrival <= departure) errors.push(field(`${prefix}.flightDetails.arrival.localDateTime`, "arrival_before_departure", "Arrival must be after departure."));
  } else if (item.type !== "flight" && item.localDate && item.localTime) {
    const result = resolveLocal(item.localDate, item.localTime, item.timeZone ?? tripZone, item.timeDisambiguation);
    if (!result.ok) errors.push(field(`${prefix}.${result.reason === "ambiguous" ? "timeDisambiguation" : "localTime"}`, result.reason === "gap" ? "nonexistent_local_time" : "ambiguous_local_time", result.reason === "gap" ? "This local time does not exist in that time zone." : "Choose the earlier or later occurrence of this local time."));
  }
  return errors;
}

/**
 * One source item through the whole pipeline: its structure, the normalized draft, then the rules that need the
 * trip's time zone. The preview shows what it returns; an AI chat's items (CONNECT-4) are checked the same way.
 */
export function previewItem(raw: unknown, index: number, tripZone: string | null): ImportPreviewDTO["items"][number] {
  const prefix = `items[${index}]`;
  if (!object(raw)) {
    const errors = [field(prefix, "invalid_item", "This item must be an object. Skip it or ask the AI to repair it.")];
    return { index, values: {}, sourceErrors: errors, errors, included: true };
  }
  const sourceErrors = itemUnknowns(raw, prefix);
  const sourceChecked = sourceItemSchema.safeParse(raw);
  if (!sourceChecked.success) sourceErrors.push(...zodErrors(sourceChecked.error, prefix));
  const values = normalizedItem(raw);
  const errors = [...sourceErrors];
  const checked = planItemDraftSchema.safeParse(values);
  if (!checked.success) errors.push(...zodErrors(checked.error, prefix));
  else if (tripZone) errors.push(...itemSemanticErrors(checked.data, tripZone, prefix));
  return { index, values, sourceErrors: uniqueErrors(sourceErrors), errors: uniqueErrors(errors), included: true };
}

/** Items an AI chat sends, checked as an import checks them: the normalized drafts, or every error with its path. */
export function checkAiItems(raw: unknown[], tripZone: string): { drafts: PlanItemDraftDTO[] } | { errors: FieldError[] } {
  const previews = raw.map((item, index) => previewItem(item, index, tripZone));
  const errors = previews.flatMap((p) => p.errors);
  if (errors.length) return { errors };
  return { drafts: previews.map((p) => planItemDraftSchema.parse(p.values)) };
}

/** Pure, no-write import preview. The caller keeps the pasted response only in tab memory. */
export function previewImport(responseText: string, ownerProvidedBudget: MoneyDTO | null): PreviewImportResult {
  const parsedBudget = ownerProvidedBudget === null ? null : importMoneySchema.safeParse(ownerProvidedBudget);
  if (parsedBudget && !parsedBudget.success) return { ok: false, code: "invalid_structure", errors: zodErrors(parsedBudget.error, "ownerProvidedBudget") };
  const { value, errors: parseErrors } = parsedResponse(responseText);
  if (parseErrors.length) return { ok: false, code: "malformed_json", errors: parseErrors };
  if (!object(value)) return { ok: false, code: "invalid_structure", errors: [field("responseText", "invalid_structure", "The response must be one JSON object.")] };
  const rootUnknown = unknownKeys(value, ROOT_KEYS, "");
  if (rootUnknown.length) return { ok: false, code: "unknown_field", errors: rootUnknown };
  if (value.formatVersion !== 1) return { ok: false, code: "unsupported_version", errors: [field("formatVersion", "unsupported_version", "Use Travel Planner JSON formatVersion 1.")] };
  if (!object(value.trip) || !Array.isArray(value.items)) return { ok: false, code: "invalid_structure", errors: [field("responseText", "invalid_structure", "The response needs a trip object and an items array.")] };
  if (value.items.length > 250) return { ok: false, code: "too_many_items", errors: [field("items", "too_many_items", "A response can contain at most 250 items. Shorten it and paste again.")] };
  const tripUnknown = unknownKeys(value.trip, TRIP_KEYS, "trip");
  tripUnknown.push(...nestedUnknowns(value.trip.budget, MONEY_KEYS, "trip.budget"));
  if (tripUnknown.length) return { ok: false, code: "unknown_field", errors: tripUnknown };

  const warning = budgetWarning(value.trip.budget, ownerProvidedBudget);
  const offered = warning && value.trip.budget !== undefined ? importMoneySchema.safeParse(value.trip.budget) : null;
  const aiBudget = offered?.success ? { amount: trimAmount(offered.data.amount), currency: offered.data.currency } : null;
  const tripValues = { ...pick(value.trip, TRIP_KEYS), budget: ownerProvidedBudget };
  const tripParsed = tripDraftSchema.safeParse(tripValues);
  const tripErrors = tripParsed.success ? [] : zodErrors(tripParsed.error, "trip");
  const tripZone = tripParsed.success ? tripParsed.data.timeZone : null;
  const items: ImportPreviewDTO["items"] = value.items.map((raw, index) => previewItem(raw, index, tripZone));
  return { ok: true, preview: { trip: { values: tripValues, errors: tripErrors, warnings: warning ? [warning] : [], aiBudget }, items } };
}

/** Repeat strict normalized validation on the server before an atomic commit. */
export function validateImportCommit(value: unknown) {
  return importCommitSchema.safeParse(value);
}
