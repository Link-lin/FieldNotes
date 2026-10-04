import "server-only";
import type { Kysely } from "kysely";
import type { DB, PlanItemRow } from "@/server/core/db/schema";
import { conflict, HttpError, invalid } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";
import { requireTripEditor, requireTripRead } from "@/server/auth/access";
import { bumpTripVersion } from "@/server/modules/trips/trips.repository";
import type { PlanItemDTO } from "@/shared/dto";
import { itemInputSchema, toFieldErrors, type ItemInput } from "@/shared/schemas";
import { dateInZone, resolveLocal } from "@/shared/time";
import { itemDto } from "./items.mapper";
import * as repo from "./items.repository";
import { canMarkBooked, scheduleErrors, toValues } from "./items.rules";
import { applyAiPatch, priceChanged, type AiItemPatch } from "./items.ai";
import { countUsage } from "@/server/modules/usage/usage.service";
import type { UsageEvent } from "@/server/modules/usage/usage.rules";

export const ITEM_CAP = 250;
export const RESTORE_WINDOW_MS = 10 * 60 * 1000;

/*
 * Plan item actions (TRIP-8, TRIP-9, PLAN-3). Each runs in one transaction that locks the trip,
 * checks the owner, purges expired deletions and bumps the trip version.
 */

const dto = (row: PlanItemRow, zone: string, now: Date): PlanItemDTO => itemDto(row, zone, dateInZone(zone, now.getTime()));
const capError = () => new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events.`);
const restoreExpired = () => new HttpError(410, "restore_expired", "This event was deleted more than 10 minutes ago and can't be restored.");

export async function createItem(db: Kysely<DB>, actor: Actor, tripId: string, input: ItemInput, now = new Date()): Promise<PlanItemDTO> {
  const created = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    if ((await repo.liveCount(tx, trip.id)) >= ITEM_CAP) throw capError();
    const errs = scheduleErrors(input, trip.time_zone);
    if (errs.length) throw invalid(errs);
    const values = toValues(input, null);
    if ("path" in values) throw invalid([values]);
    const row = await repo.insertItem(tx, trip.id, "manual", values);
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
  await countUsage(db, [{ name: "manual_item_created" }, ...bookingUsage(null, created)]);
  return created;
}

/** Pilot measures for a saved item: a new or changed book-by date, and a move to Booked. */
function bookingUsage(before: { booking_due_date: string | null; booking_status: string } | null, after: PlanItemDTO): UsageEvent[] {
  const events: UsageEvent[] = [];
  if (after.bookingDueDate && after.bookingDueDate !== before?.booking_due_date) events.push({ name: "due_date_set" });
  if (after.bookingStatus === "booked" && before?.booking_status !== "booked") events.push({ name: "item_booked" });
  return events;
}

export async function updateItem(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  body: { item: ItemInput; expectedVersion: number; confirmTypeChange?: boolean; confirmPrice?: boolean },
  now = new Date(),
): Promise<PlanItemDTO> {
  let before: PlanItemRow | null = null;
  const saved = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
    before = current;
    const input = body.item;
    const crossesFlight = (current.type === "flight") !== (input.type === "flight");
    if (crossesFlight && !body.confirmTypeChange) {
      throw new HttpError(409, "type_change_confirmation_required", "Changing to or from a flight clears the schedule fields. Confirm to continue.");
    }
    const errs = scheduleErrors(input, trip.time_zone);
    if (errs.length) throw invalid(errs);
    const values = toValues(input, current, body.confirmPrice === true);
    if ("path" in values) throw invalid([values]);
    const row = await repo.updateItemRow(tx, current.id, body.expectedVersion, values);
    if (!row) throw conflict();
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
  const prior = before as PlanItemRow | null;
  await countUsage(db, [...(prior?.source === "ai" ? [{ name: "ai_item_edited" as const }] : []), ...bookingUsage(prior, saved)]);
  return saved;
}

/** TRIP-10: save an event's notes from its side panel. Same owner, version and trip-version rules as a full edit. */
export async function updateItemNotes(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  body: { notes: string | null; expectedVersion: number },
  now = new Date(),
): Promise<PlanItemDTO> {
  let wasAi = false;
  const saved = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
    const notes = body.notes?.trim() || null;
    const row = await repo.updateNotes(tx, current.id, body.expectedVersion, notes);
    if (!row) throw conflict();
    await bumpTripVersion(tx, trip.id);
    wasAi = current.source === "ai";
    return dto(row, trip.time_zone, now);
  });
  if (wasAi) await countUsage(db, [{ name: "ai_item_edited" }]);
  return saved;
}

/**
 * BOOK-3, BOOK-4: from a booking list, mark an event Booked (which clears its book-by date), or set,
 * change or clear the book-by date. A flight can be Booked only with its FLIGHT-2 fields. Same owner,
 * version and trip-version rules as a full edit; only the booking pilot counts apply.
 */
export async function updateItemBooking(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  body: { bookingStatus: "needs_booking" | "booked"; bookingDueDate: string | null; expectedVersion: number },
  now = new Date(),
): Promise<PlanItemDTO> {
  let before: PlanItemRow | null = null;
  const saved = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
    if (body.bookingStatus === "booked" && !canMarkBooked(current)) {
      throw invalid([{ path: "bookingStatus", code: "flight_incomplete", message: "Add both airports, their local times and time zones before marking this flight booked." }]);
    }
    before = current;
    const row = await repo.updateBooking(tx, current.id, body.expectedVersion, body.bookingStatus, body.bookingStatus === "needs_booking" ? body.bookingDueDate : null);
    if (!row) throw conflict();
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
  await countUsage(db, bookingUsage(before as PlanItemRow | null, saved));
  return saved;
}

/** TRIP-8: immediate soft delete; restorable for 10 minutes. */
export async function deleteItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number): Promise<void> {
  const source = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== expectedVersion) throw conflict();
    await repo.softDelete(tx, current.id);
    await bumpTripVersion(tx, trip.id);
    return current.source;
  });
  if (source === "ai") await countUsage(db, [{ name: "ai_item_deleted" }]);
}

/** Undo within 10 minutes: the same row comes back, if the cap allows and its time still exists. */
export async function restoreItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId, true);
    if (!current.deleted_at) return dto(current, trip.time_zone, now);
    if (now.getTime() - new Date(current.deleted_at).getTime() > RESTORE_WINDOW_MS) throw restoreExpired();
    if ((await repo.liveCount(tx, trip.id)) >= ITEM_CAP) throw capError();
    // The trip time zone may have changed since the delete; the restored time must still exist.
    if (current.type !== "flight" && current.local_date && current.local_time && !current.time_zone) {
      const r = resolveLocal(current.local_date, current.local_time.slice(0, 5), trip.time_zone, current.time_disambiguation);
      if (!r.ok) {
        throw new HttpError(409, "restore_time_invalid", `This event's time ${current.local_time.slice(0, 5)} ${r.reason === "gap" ? "doesn't exist" : "happens twice"} on ${current.local_date} in ${trip.time_zone}, so it can't be restored. Add it again with a new time.`);
      }
    }
    // The purge uses the database clock. If it is ahead of this server's, it may remove this row
    // after the check above passed; that is still an expired restore, not a server error.
    await repo.purgeExpired(tx, trip.id);
    const row = await repo.undelete(tx, current.id);
    if (!row) throw restoreExpired();
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** PLAN-3: duplicate; a booked item becomes "needs booking" with no due date. */
export async function duplicateItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    const src = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (src.version !== expectedVersion) throw conflict();
    await repo.purgeExpired(tx, trip.id);
    if ((await repo.liveCount(tx, trip.id)) >= ITEM_CAP) throw capError();
    const row = await repo.copyItem(tx, src);
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** CONNECT-3: read one item in full (a connected chat's `get_item`). Any role that can read the trip. */
export async function getItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, now = new Date()): Promise<PlanItemDTO> {
  const { trip } = await requireTripRead(db, actor, tripId);
  const row = await repo.liveItem(db, trip.id, itemId);
  return dto(row, trip.time_zone, now);
}

/**
 * CONNECT-3, CONNECT-4: a connected AI chat changes some fields of an item. The change merges onto the item as it
 * stands under the trip lock and goes through the same schema and schedule checks as an edit in the app, so a field it
 * does not name is never overwritten. `source` is kept; a new or changed price becomes an AI estimate; a place change
 * clears the map pin. The edit counts nothing in the pilot totals, which measure people correcting AI output.
 */
export async function updateItemByAi(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  patch: AiItemPatch,
  now = new Date(),
): Promise<{ item: PlanItemDTO; clearedPin: boolean }> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    const before = dto(current, trip.time_zone, now);
    const applied = applyAiPatch(before, patch);
    if ("errors" in applied) throw invalid(applied.errors);
    const parsed = itemInputSchema.safeParse(applied.input);
    if (!parsed.success) throw invalid(toFieldErrors(parsed.error));
    const errs = scheduleErrors(parsed.data, trip.time_zone);
    if (errs.length) throw invalid(errs);
    const values = toValues(parsed.data, current);
    if ("path" in values) throw invalid([values]);
    if (priceChanged(before.plannedPrice, parsed.data.plannedPrice)) values.price_source = "ai";
    const row = await repo.updateItemRow(tx, current.id, current.version, values);
    if (!row) throw conflict();
    await bumpTripVersion(tx, trip.id);
    return { item: dto(row, trip.time_zone, now), clearedPin: applied.clearedPin };
  });
}

/** CONNECT-3: a connected AI chat deletes an item; it can be restored for 10 minutes (TRIP-8). Not counted in the pilot. */
export async function deleteItemByAi(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string): Promise<{ title: string }> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    await repo.softDelete(tx, current.id);
    await bumpTripVersion(tx, trip.id);
    return { title: current.title };
  });
}
