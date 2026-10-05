import { z } from "zod";
import { AMOUNT_PATTERN } from "./money";
import { isCurrencyCode } from "./currencies";
import { canonicalTimeZone, isDate, isTime, isLocalDateTime, isTimeZone, MAX_TRIP_DAYS, withinTripLength } from "./time";
import { parseWebUrl, MAX_URL_LENGTH } from "./map-links";
import type { FieldError } from "./dto";

const dateStr = z.string().refine(isDate, { message: "Use a real date (YYYY-MM-DD)." });
const timeStr = z.string().refine(isTime, { message: "Use a 24-hour time (HH:MM)." });
const localDateTime = z.string().refine(isLocalDateTime, { message: "Use a local date and time (YYYY-MM-DDTHH:MM)." });
const zone = z.string().max(100).refine(isTimeZone, { message: "Choose a valid time zone." }).transform(canonicalTimeZone);
const currency = z.string().refine(isCurrencyCode, { message: "Choose a real currency code, like USD." });
const amount = z.string().regex(AMOUNT_PATTERN, { message: "Use zero or more, with up to 4 decimals." });
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v.trim() === "" ? null : v.trim()));
const choice = z.enum(["earlier", "later"]).nullable();

/** A trip is at most MAX_TRIP_DAYS long; invalid or reversed dates are reported by their own rules. */
export const tripLengthOk = (t: { startDate: string; endDate: string }) =>
  !isDate(t.startDate) || !isDate(t.endDate) || t.startDate > t.endDate || withinTripLength(t.startDate, t.endDate);
export const tripLengthIssue = { path: ["endDate"], message: `A trip can be at most ${MAX_TRIP_DAYS} days long.` };

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
  .refine((t) => t.startDate <= t.endDate, { path: ["endDate"], message: "The trip can't end before it starts." })
  .refine(tripLengthOk, tripLengthIssue);

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
  .refine((t) => t.startDate <= t.endDate, { path: ["endDate"], message: "The trip can't end before it starts." })
  .refine(tripLengthOk, tripLengthIssue);

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
      .pipe(z.string().regex(/^[A-Z0-9]{3,4}$/, { message: "Use a three- or four-character airport code." }))
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
    airline: optionalText(120),
    flightNumber: optionalText(24),
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
  .object({ item: itemInputSchema, expectedVersion: z.number().int().min(1), confirmTypeChange: z.boolean().optional(), confirmPrice: z.boolean().optional() })
  .strict();
/**
 * TRIP-10: the owner edits an event's notes from its side panel; the rest of the event is unchanged. `baseNotes`, the notes
 * the edit started from, lets it save over a newer version of the event whose notes are still those (TRIP-11).
 */
export const itemNotesSchema = z.object({ notes: optionalText(5000), expectedVersion: z.number().int().min(1), baseNotes: z.string().max(5000).nullable().optional() }).strict();
export const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
/** IMPORT-7: mark AI drafts reviewed, one event or a whole trip's at once; `reviewed: false` undoes it. */
export const itemReviewSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().min(1) }).strict())
      .min(1)
      .max(250)
      .refine((list) => new Set(list.map((i) => i.id)).size === list.length, { message: "List each event once." }),
    reviewed: z.boolean(),
  })
  .strict();
export type ItemReview = z.infer<typeof itemReviewSchema>;
/** BOOK-3, BOOK-4: a booking-list action. Booked clears the book-by date; the service checks FLIGHT-2. */
export const itemBookingSchema = z
  .object({ bookingStatus: z.enum(["needs_booking", "booked"]), bookingDueDate: dateStr.nullable(), expectedVersion: z.number().int().min(1) })
  .strict()
  .refine((b) => !b.bookingDueDate || b.bookingStatus === "needs_booking", { path: ["bookingDueDate"], message: "A book-by date is only for events that need booking." });

/** Convert zod issues into stable, path-addressed field errors. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "["),
    code: i.code === "custom" ? "invalid" : i.code,
    message: i.message,
  }));
}

/** POST /api/trips/{id}/time-zone-preview */
export const timeZonePreviewSchema = z.object({ timeZone: zone, expectedVersion: z.number().int().min(1) }).strict();

/**
 * DELETE /api/account: the person typed DELETE, and chose what happens to a trip they own: keep it with its
 * other owners, delete it, or make someone on it (by grant id) its owner. At most one choice per trip
 * (ACCESS-10). A trip with no choice stays with its other owners, or is deleted when nobody else is on it.
 */
const tripDecision = z.discriminatedUnion("action", [
  z.object({ tripId: z.string().uuid(), action: z.literal("keep") }).strict(),
  z.object({ tripId: z.string().uuid(), action: z.literal("delete") }).strict(),
  z.object({ tripId: z.string().uuid(), action: z.literal("transfer"), personId: z.string().uuid() }).strict(),
]);
export const accountDeleteSchema = z
  .object({ confirm: z.literal("DELETE"), trips: z.array(tripDecision).max(200).default([]) })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.trips.forEach((d, i) => {
      if (seen.has(d.tripId)) ctx.addIssue({ code: "custom", path: ["trips", i, "tripId"], message: "Choose one thing for each trip." });
      seen.add(d.tripId);
    });
  });

/**
 * ACCESS-3: invite one person with a role (viewer unless chosen otherwise), either by email address (stored trimmed
 * and lowercased) or by link, with a label the owner picks for them (shown only to owners). Exactly one of the two.
 */
const memberRole = z.enum(["viewer", "editor", "owner"], { message: "Choose viewer, editor or owner." });
export const invitationCreateSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254, { message: "That email address is too long." }).pipe(z.email({ message: "Enter an email address, like sam@example.com." })).optional(),
    label: z.string().trim().min(1, { message: "Give the person a name or note, like Mei on WeChat." }).max(80, { message: "Keep it to 80 characters or fewer." }).optional(),
    role: memberRole.default("viewer"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.email === undefined && value.label === undefined) ctx.addIssue({ code: "custom", path: ["email"], message: "Enter the email address of the person you want to invite." });
    if (value.email !== undefined && value.label !== undefined) ctx.addIssue({ code: "custom", path: ["label"], message: "Invite by email or by link, not both." });
  });

/** ACCESS-5: an owner changes what a person the trip is shared with may do. */
export const invitationRoleSchema = z.object({ role: memberRole }).strict();

/** The token from an invitation link's fragment. Its format is checked by the service, which answers with one generic error. */
export const invitationStageSchema = z.object({ token: z.string().max(200) }).strict();
