import { z } from "zod";
import type { FieldError, ItemType } from "./dto";
import { isCurrencyCode } from "./currencies";
import { AMOUNT_PATTERN, trimAmount } from "./money";
import { parseWebUrl } from "./map-links";
import { isDate, isLocalDateTime, isTime, isTimeZone, resolveLocal } from "./time";

/** Wire types for the external JSON v1 preview and its owner-confirmed commit. */
const date = z.string().refine(isDate, "Enter a real date (YYYY-MM-DD).");
const time = z.string().refine(isTime, "Enter a 24-hour time (HH:mm).");
const localDateTime = z.string().refine(isLocalDateTime, "Enter a real local date and time (YYYY-MM-DDTHH:mm).");
const zone = z.string().refine(isTimeZone, "Enter a valid IANA time zone.");
const currency = z.string().refine(isCurrencyCode, "Enter a supported ISO 4217 currency code.");
const amount = z.string().regex(AMOUNT_PATTERN, "Enter a nonnegative decimal string with up to four decimal places.");
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

export const importMoneySchema = z.object({ amount, currency }).strict();
export const previewRequestSchema = z.object({
  responseText: z.string().min(1),
  ownerProvidedBudget: nullable(importMoneySchema),
}).strict();

const link = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().max(2048).refine((value) => parseWebUrl(value) !== null, "Enter a full http or https link without user information."),
}).strict();

const endpoint = z.object({
  airportCode: nullable(z.string().regex(/^[A-Z0-9]{3,4}$/, "Use a 3–4 character uppercase airport code.")),
  localDateTime: nullable(localDateTime),
  timeZone: nullable(zone),
  timeDisambiguation: nullable(z.enum(["earlier", "later"])),
}).strict();

const flightDetails = z.object({
  plannedDepartureDate: nullable(date),
  airline: nullable(z.string().max(120)),
  flightNumber: nullable(z.string().max(24)),
  departure: endpoint,
  arrival: endpoint,
}).strict();

export const tripDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  destination: z.string().trim().min(1).max(160),
  startDate: date,
  endDate: date,
  timeZone: zone,
  budget: nullable(importMoneySchema),
}).strict().refine((trip) => trip.startDate <= trip.endDate, { path: ["endDate"], message: "The trip can't end before it starts." });

export const planItemDraftSchema = z.object({
  type: z.enum(["flight", "lodging", "transport", "meal", "activity", "other"]),
  title: z.string().trim().min(1).max(200),
  location: nullable(z.string().max(500)),
  notes: nullable(z.string().max(5000)),
  links: z.array(link).max(20),
  bookingStatus: z.enum(["needs_booking", "not_required"]),
  bookingDueDate: nullable(date),
  plannedPrice: nullable(importMoneySchema),
  localDate: nullable(date),
  localTime: nullable(time),
  timeZone: nullable(zone),
  durationMinutes: nullable(z.number().int().min(1).max(1440)),
  timeDisambiguation: nullable(z.enum(["earlier", "later"])),
  flightDetails: nullable(flightDetails),
}).strict().superRefine((item, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (item.bookingDueDate && item.bookingStatus !== "needs_booking") issue(["bookingDueDate"], "A book-by date requires Needs booking.");
  if (item.type === "flight") {
    if (item.bookingStatus !== "needs_booking") issue(["bookingStatus"], "Imported flights must need booking.");
    if (!item.flightDetails) issue(["flightDetails"], "Add flight details, even if no segment values are known yet.");
    if (item.localDate !== null || item.localTime !== null || item.timeZone !== null || item.durationMinutes !== null || item.timeDisambiguation !== null) {
      issue(["flightDetails"], "Flights use flightDetails instead of the general schedule fields.");
    }
    if (item.flightDetails) {
      const flight = item.flightDetails;
      if (flight.plannedDepartureDate && flight.departure.localDateTime) issue(["flightDetails", "plannedDepartureDate"], "Use the exact departure time instead of a fallback date.");
      for (const side of ["departure", "arrival"] as const) {
        const endpoint = flight[side];
        if (endpoint.localDateTime && !endpoint.timeZone) issue(["flightDetails", side, "timeZone"], "Add the airport's time zone.");
        if (endpoint.timeDisambiguation && !endpoint.localDateTime) issue(["flightDetails", side, "timeDisambiguation"], "Only choose an offset for a supplied local time.");
      }
    }
  } else {
    if (item.flightDetails) issue(["flightDetails"], "Only flights can have flight details.");
    if (item.localTime && !item.localDate) issue(["localTime"], "A time needs a date.");
    if (item.timeDisambiguation && !item.localTime) issue(["timeDisambiguation"], "Only choose an offset for a supplied local time.");
  }
});

export const importCommitSchema = z.object({
  expectedFormatVersion: z.literal(1),
  ownerProvidedBudget: nullable(importMoneySchema),
  trip: tripDraftSchema,
  items: z.array(planItemDraftSchema).max(250),
}).strict().superRefine((value, ctx) => {
  const budget = value.ownerProvidedBudget;
  const tripBudget = value.trip.budget;
  if ((budget === null) !== (tripBudget === null) || (budget && tripBudget &&
    (trimAmount(budget.amount) !== trimAmount(tripBudget.amount) || budget.currency !== tripBudget.currency))) {
    ctx.addIssue({ code: "custom", path: ["trip", "budget"], message: "The trip budget must match the owner-entered budget." });
  }
  for (let i = 0; i < value.items.length; i++) {
    const item = value.items[i]!;
    if (item.type === "flight") {
      const flight = item.flightDetails;
      if (!flight) continue;
      const instants: Partial<Record<"departure" | "arrival", number>> = {};
      for (const side of ["departure", "arrival"] as const) {
        const endpoint = flight[side];
        if (!endpoint.localDateTime || !endpoint.timeZone) continue;
        const resolved = resolveLocal(endpoint.localDateTime.slice(0, 10), endpoint.localDateTime.slice(11), endpoint.timeZone, endpoint.timeDisambiguation);
        if (!resolved.ok) ctx.addIssue({ code: "custom", path: ["items", i, "flightDetails", side, resolved.reason === "ambiguous" ? "timeDisambiguation" : "localDateTime"], message: resolved.reason === "gap" ? "This local time does not exist in its time zone." : "Choose the earlier or later occurrence of this local time." });
        else instants[side] = resolved.epochMs;
      }
      if (instants.departure !== undefined && instants.arrival !== undefined && instants.arrival <= instants.departure) {
        ctx.addIssue({ code: "custom", path: ["items", i, "flightDetails", "arrival", "localDateTime"], message: "Arrival must be after departure." });
      }
    } else if (item.localDate && item.localTime) {
      const resolved = resolveLocal(item.localDate, item.localTime, item.timeZone ?? value.trip.timeZone, item.timeDisambiguation);
      if (!resolved.ok) ctx.addIssue({ code: "custom", path: ["items", i, resolved.reason === "ambiguous" ? "timeDisambiguation" : "localTime"], message: resolved.reason === "gap" ? "This local time does not exist in its time zone." : "Choose the earlier or later occurrence of this local time." });
    }
  }
});

export type TripDraftDTO = z.infer<typeof tripDraftSchema>;
export type PlanItemDraftDTO = z.infer<typeof planItemDraftSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
export type ImportPreviewDTO = {
  trip: {
    values: Partial<Record<keyof TripDraftDTO, unknown>>;
    errors: FieldError[];
    warnings: FieldError[];
  };
  items: Array<{
    index: number;
    values: Partial<Record<keyof PlanItemDraftDTO, unknown>>;
    /** Source-only contract errors remain until the owner corrects or removes that field. */
    sourceErrors: FieldError[];
    errors: FieldError[];
    included: boolean;
  }>;
};
export type PreviewImportResult =
  | { ok: true; preview: ImportPreviewDTO }
  | { ok: false; code: "malformed_json" | "unsupported_version" | "invalid_structure" | "unknown_field" | "too_many_items"; errors: FieldError[] };

/** A source item type is checked before it becomes a normalized draft. */
export type ImportSourceItemType = ItemType;
