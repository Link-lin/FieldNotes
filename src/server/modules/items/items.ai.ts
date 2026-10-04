import "server-only";
import { z } from "zod";
import type { FieldError, PlanItemDTO } from "@/shared/dto";
import { trimAmount } from "@/shared/money";
import type { ItemInput } from "@/shared/schemas";

/*
 * What a connected AI chat may change on an existing item (CONNECT-3, CONNECT-4), as pure rules: the shape of its
 * patch, and how the patch merges onto the stored item. The merged item then goes through the same schema and schedule
 * checks as an edit in the app, so this file only adds what is specific to an AI: no `Booked`, no quote, no book-by
 * date, no map link, and a place change drops the map pin.
 */

const endpointPatch = z
  .object({
    airportCode: z.string().max(4).nullable().optional(),
    localDateTime: z.string().max(16).nullable().optional(),
    timeZone: z.string().max(100).nullable().optional(),
  })
  .strict();

/** `null` clears an optional field; a field that is left out is left alone. */
export const aiItemPatchSchema = z
  .object({
    title: z.string().max(200).optional(),
    type: z.enum(["lodging", "transport", "meal", "activity", "other"], { message: "An item can't become a flight, and a flight can't become another type. Delete it and add the right one." }).optional(),
    location: z.string().max(500).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    links: z.array(z.object({ label: z.string().max(80), url: z.string().max(2048) }).strict()).max(20).optional(),
    plannedPrice: z.object({ amount: z.string().max(40), currency: z.string().max(3) }).strict().nullable().optional(),
    localDate: z.string().max(10).nullable().optional(),
    localTime: z.string().max(5).nullable().optional(),
    timeZone: z.string().max(100).nullable().optional(),
    durationMinutes: z.number().int().nullable().optional(),
    bookingStatus: z.enum(["Needs booking", "Not required"]).optional(),
    flightDetails: z
      .object({
        plannedDepartureDate: z.string().max(10).nullable().optional(),
        airline: z.string().max(120).nullable().optional(),
        flightNumber: z.string().max(24).nullable().optional(),
        departure: endpointPatch.optional(),
        arrival: endpointPatch.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AiItemPatch = z.infer<typeof aiItemPatchSchema>;

/** The stored item in the shape the item form saves, which is what the shared schema checks. */
export function itemInputOf(dto: PlanItemDTO): ItemInput {
  const base = {
    title: dto.title,
    location: dto.location,
    notes: dto.notes,
    links: dto.links,
    mapUrl: dto.mapUrl,
    bookingStatus: dto.bookingStatus,
    bookingDueDate: dto.bookingDueDate,
    plannedPrice: dto.plannedPrice ? { amount: dto.plannedPrice.amount, currency: dto.plannedPrice.currency, label: dto.plannedPrice.label } : null,
  };
  if (dto.type === "flight") {
    const f = dto.flightDetails!;
    return {
      ...base,
      type: "flight",
      plannedDepartureDate: f.plannedDepartureDate,
      airline: f.airline,
      flightNumber: f.flightNumber,
      departure: { ...f.departure },
      arrival: { ...f.arrival },
    };
  }
  return {
    ...base,
    type: dto.type,
    localDate: dto.localDate,
    localTime: dto.localTime,
    timeZone: dto.timeZone,
    timeDisambiguation: dto.timeDisambiguation,
    durationMinutes: dto.durationMinutes,
  };
}

const blank = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === "" ? null : v.trim());

export type AiPatchResult = { input: ItemInput; clearedPin: boolean } | { errors: FieldError[] };

/** Merges an AI chat's patch onto the stored item, or says why it cannot. The caller validates the merged item. */
export function applyAiPatch(current: PlanItemDTO, patch: AiItemPatch): AiPatchResult {
  const errors: FieldError[] = [];
  const refuse = (path: string, message: string) => errors.push({ path, code: "invalid", message });
  const input = structuredClone(itemInputOf(current)) as Record<string, unknown> & ItemInput;
  const flight = current.type === "flight";

  if (Object.keys(patch).length === 0) refuse("", "Nothing to change: send at least one field.");

  if (patch.type !== undefined && patch.type !== current.type) {
    if (flight) refuse("type", "A flight can't become another type. Delete it and add the right one.");
    else input.type = patch.type;
  }
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.location !== undefined) input.location = patch.location;
  if (patch.notes !== undefined) input.notes = patch.notes;
  if (patch.links !== undefined) input.links = patch.links;

  if (flight) {
    for (const key of ["localDate", "localTime", "timeZone", "durationMinutes"] as const) {
      if (patch[key] !== undefined) refuse(key, "A flight uses flightDetails (airports and local times) instead of this field.");
    }
    const details = patch.flightDetails;
    if (details && input.type === "flight") {
      if (details.plannedDepartureDate !== undefined) input.plannedDepartureDate = details.plannedDepartureDate;
      if (details.airline !== undefined) input.airline = details.airline;
      if (details.flightNumber !== undefined) input.flightNumber = details.flightNumber;
      for (const side of ["departure", "arrival"] as const) {
        const change = details[side];
        if (!change) continue;
        const end = input[side];
        if (change.airportCode !== undefined) end.airportCode = change.airportCode;
        if (change.timeZone !== undefined) end.timeZone = change.timeZone;
        if (change.localDateTime !== undefined) {
          end.localDateTime = change.localDateTime;
          end.timeDisambiguation = null;
        }
      }
    }
  } else {
    if (patch.flightDetails !== undefined) refuse("flightDetails", "Only a flight has flightDetails.");
    if (input.type !== "flight") {
      const when = input as Extract<ItemInput, { localDate: unknown }>;
      let rescheduled = false;
      if (patch.localDate !== undefined) { when.localDate = patch.localDate; rescheduled = true; }
      if (patch.localTime !== undefined) { when.localTime = patch.localTime; rescheduled = true; }
      if (patch.timeZone !== undefined) { when.timeZone = patch.timeZone; rescheduled = true; }
      if (patch.durationMinutes !== undefined) when.durationMinutes = patch.durationMinutes;
      // An earlier/later choice belonged to the old time.
      if (rescheduled) when.timeDisambiguation = null;
    }
  }

  // A saved map pin belongs to the old place; an AI cannot supply a link or coordinates (MAP-2), so the pin goes.
  let clearedPin = false;
  if (patch.location !== undefined && blank(patch.location) !== current.location && current.mapUrl) {
    input.mapUrl = null;
    clearedPin = true;
  }

  // Booking: an AI can say an item needs booking or not, never that it is booked, and never undo a person's Booked.
  if (patch.bookingStatus !== undefined) {
    if (current.bookingStatus === "booked") refuse("bookingStatus", "This item is marked Booked, which only a person can change in Field Notes.");
    else {
      input.bookingStatus = patch.bookingStatus === "Needs booking" ? "needs_booking" : "not_required";
      if (input.bookingStatus !== "needs_booking") input.bookingDueDate = null;
    }
  }

  if (patch.plannedPrice !== undefined) {
    if (patch.plannedPrice === null) input.plannedPrice = null;
    else {
      const old = current.plannedPrice;
      const same = old && old.currency === patch.plannedPrice.currency && trimAmount(old.amount) === trimAmount(patch.plannedPrice.amount);
      // Saying the same price again keeps whatever it already was (a person's quote stays a quote).
      input.plannedPrice = { amount: patch.plannedPrice.amount, currency: patch.plannedPrice.currency, label: same ? old.label : "estimate" };
    }
  }

  return errors.length ? { errors } : { input: input as ItemInput, clearedPin };
}

/** Whether the merged price differs from the stored one: a new or changed price is an AI estimate (BUDGET-4). */
export function priceChanged(before: PlanItemDTO["plannedPrice"], after: ItemInput["plannedPrice"]): boolean {
  if (!after) return false;
  if (!before) return true;
  return before.currency !== after.currency || trimAmount(before.amount) !== trimAmount(after.amount) || before.label !== after.label;
}
