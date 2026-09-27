import { z } from "zod";
import { AMOUNT_PATTERN } from "./money";
import { isCurrencyCode } from "./currencies";
import { canonicalTimeZone, isDate, isTime, isLocalDateTime, isTimeZone } from "./time";
import { parseWebUrl, MAX_URL_LENGTH } from "./map-links";
import type { FieldError } from "./dto";

const dateStr = z.string().refine(isDate, { message: "Use a real date (YYYY-MM-DD)." });
const timeStr = z.string().refine(isTime, { message: "Use a 24-hour time (HH:MM)." });
const localDateTime = z.string().refine(isLocalDateTime, { message: "Use a local date and time (YYYY-MM-DDTHH:MM)." });
const zone = z.string().refine(isTimeZone, { message: "Choose a valid time zone." }).transform(canonicalTimeZone);
const currency = z.string().refine(isCurrencyCode, { message: "Choose a real currency code, like USD." });
const amount = z.string().regex(AMOUNT_PATTERN, { message: "Use zero or more, with up to 4 decimals." });
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v.trim() === "" ? null : v.trim()));
const choice = z.enum(["earlier", "later"]).nullable();

export const moneySchema = z.object({ amount, currency }).strict();

export const tripInputSchema = z
  .object({
    title: z.string().trim().min(1, { message: "Give the trip a name." }).max(120),
    destination: z.string().trim().min(1, { message: "Add a main destination." }).max(160),
    startDate: dateStr,
    endDate: dateStr,
    timeZone: zone,
    budget: moneySchema.nullable(),
  })
  .strict()
  .refine((t) => t.startDate <= t.endDate, { path: ["endDate"], message: "The trip can't end before it starts." });

export const tripPatchSchema = z
  .object({
    title: z.string().trim().min(1, { message: "Give the trip a name." }).max(120),
    destination: z.string().trim().min(1, { message: "Add a main destination." }).max(160),
    startDate: dateStr,
    endDate: dateStr,
    timeZone: zone,
    budget: moneySchema.nullable(),
    expectedVersion: z.number().int().min(1),
    atlasLocation: z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
      .strict()
      .nullable()
      .optional(),
    confirmTimeZoneImpact: z.boolean().optional(),
    timeDisambiguationByItem: z.record(z.string().uuid(), z.enum(["earlier", "later"])).optional(),
  })
  .strict()
  .refine((t) => t.startDate <= t.endDate, { path: ["endDate"], message: "The trip can't end before it starts." });

export const tripDeleteSchema = z.object({ confirm: z.literal(true), expectedVersion: z.number().int().min(1) }).strict();

const link = z
  .object({
    label: z.string().trim().min(1).max(80),
    url: z.string().max(MAX_URL_LENGTH).refine((u) => parseWebUrl(u) !== null, { message: "Use an http or https link." }),
  })
  .strict();

const priceSchema = z.object({ amount, currency, label: z.enum(["estimate", "quote"]) }).strict().nullable();

const common = {
  title: z.string().trim().min(1, { message: "Describe what it is." }).max(200),
  location: optionalText(500),
  notes: optionalText(5000),
  links: z.array(link).max(20),
  mapUrl: optionalText(MAX_URL_LENGTH),
  bookingStatus: z.enum(["not_required", "needs_booking", "booked"]),
  bookingDueDate: dateStr.nullable(),
  plannedPrice: priceSchema,
};

const endpoint = z
  .object({
    airportCode: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/, { message: "Use a three-letter airport code." }))
      .nullable(),
    localDateTime: localDateTime.nullable(),
    timeZone: zone.nullable(),
    timeDisambiguation: choice,
  })
  .strict();

const flightItem = z
  .object({
    type: z.literal("flight"),
    plannedDepartureDate: dateStr.nullable(),
    airline: optionalText(80),
    flightNumber: optionalText(16),
    departure: endpoint,
    arrival: endpoint,
    ...common,
  })
  .strict();

const otherItem = z
  .object({
    type: z.enum(["lodging", "transport", "meal", "activity", "other"]),
    localDate: dateStr.nullable(),
    localTime: timeStr.nullable(),
    timeZone: zone.nullable(),
    timeDisambiguation: choice,
    durationMinutes: z.number().int().min(1).max(20160).nullable(),
    ...common,
  })
  .strict();

function crossRules(item: z.infer<typeof flightItem> | z.infer<typeof otherItem>, ctx: z.RefinementCtx) {
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (item.bookingDueDate && item.bookingStatus !== "needs_booking") add(["bookingDueDate"], "A book-by date is only for events that need booking.");
  if (item.type === "flight") {
    if (item.bookingStatus === "not_required") add(["bookingStatus"], "A flight either needs booking or is booked.");
    for (const side of ["departure", "arrival"] as const) {
      const e = item[side];
      if (e.localDateTime && !e.timeZone) add([side, "timeZone"], "Add the airport's time zone.");
      if (e.timeDisambiguation && !e.localDateTime) add([side, "timeDisambiguation"], "Only for a repeated local time.");
    }
    if (item.plannedDepartureDate && item.departure.localDateTime) add(["plannedDepartureDate"], "Use either a planned date or the exact departure time.");
    if (item.bookingStatus === "booked") {
      for (const side of ["departure", "arrival"] as const) {
        const e = item[side];
        if (!e.airportCode) add([side, "airportCode"], "Required to mark the flight booked.");
        if (!e.localDateTime) add([side, "localDateTime"], "Required to mark the flight booked.");
        if (!e.timeZone) add([side, "timeZone"], "Required to mark the flight booked.");
      }
    }
  } else {
    if (item.localTime && !item.localDate) add(["localTime"], "A time needs a date.");
    if (item.timeDisambiguation && !item.localTime) add(["timeDisambiguation"], "Only for a repeated local time.");
  }
}

export const itemInputSchema = z.discriminatedUnion("type", [flightItem, otherItem]).superRefine(crossRules);
export type ItemInput = z.infer<typeof itemInputSchema>;
export type TripInput = z.infer<typeof tripInputSchema>;
export type TripPatch = z.infer<typeof tripPatchSchema>;

export const itemPatchSchema = z
  .object({ item: itemInputSchema, expectedVersion: z.number().int().min(1), confirmTypeChange: z.boolean().optional() })
  .strict();
export const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

/** Convert zod issues into stable, path-addressed field errors. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "["),
    code: i.code === "custom" ? "invalid" : i.code,
    message: i.message,
  }));
}
