import "server-only";
import type { Kysely } from "kysely";
import type { DB, PlanItemRow } from "@/server/core/db/schema";
import { conflict, HttpError, invalid } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner } from "@/server/auth/access";
import { bumpTripVersion } from "@/server/modules/trips/trips.repository";
import type { PlanItemDTO } from "@/shared/dto";
import type { ItemInput } from "@/shared/schemas";
import { dateInZone, resolveLocal } from "@/shared/time";
import { itemDto } from "./items.mapper";
import * as repo from "./items.repository";
import { scheduleErrors, toValues } from "./items.rules";

export const ITEM_CAP = 250;
export const RESTORE_WINDOW_MS = 10 * 60 * 1000;

/*
 * Plan item actions (TRIP-8, TRIP-9, PLAN-3). Each runs in one transaction that locks the trip,
 * checks the owner, purges expired deletions and bumps the trip version.
 */

const dto = (row: PlanItemRow, zone: string, now: Date): PlanItemDTO => itemDto(row, zone, dateInZone(zone, now.getTime()));
const capError = () => new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events.`);

export async function createItem(db: Kysely<DB>, actor: Actor, tripId: string, input: ItemInput, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
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
}

export async function updateItem(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  body: { item: ItemInput; expectedVersion: number; confirmTypeChange?: boolean; confirmPrice?: boolean },
  now = new Date(),
): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
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
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
    const notes = body.notes?.trim() || null;
    const row = await repo.updateNotes(tx, current.id, body.expectedVersion, notes);
    if (!row) throw conflict();
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** TRIP-8: immediate soft delete; restorable for 10 minutes. */
export async function deleteItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await repo.purgeExpired(tx, trip.id);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (current.version !== expectedVersion) throw conflict();
    await repo.softDelete(tx, current.id);
    await bumpTripVersion(tx, trip.id);
  });
}

/** Undo within 10 minutes: the same row comes back, if the cap allows and its time still exists. */
export async function restoreItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    const current = await repo.loadItemForUpdate(tx, trip.id, itemId, true);
    if (!current.deleted_at) return dto(current, trip.time_zone, now);
    if (now.getTime() - new Date(current.deleted_at).getTime() > RESTORE_WINDOW_MS) {
      throw new HttpError(410, "restore_expired", "This event was deleted more than 10 minutes ago and can't be restored.");
    }
    if ((await repo.liveCount(tx, trip.id)) >= ITEM_CAP) throw capError();
    // The trip time zone may have changed since the delete; the restored time must still exist.
    if (current.type !== "flight" && current.local_date && current.local_time && !current.time_zone) {
      const r = resolveLocal(current.local_date, current.local_time.slice(0, 5), trip.time_zone, current.time_disambiguation);
      if (!r.ok) {
        throw new HttpError(409, "restore_time_invalid", `This event's time ${current.local_time.slice(0, 5)} ${r.reason === "gap" ? "doesn't exist" : "happens twice"} on ${current.local_date} in ${trip.time_zone}, so it can't be restored. Add it again with a new time.`);
      }
    }
    await repo.purgeExpired(tx, trip.id);
    const row = await repo.undelete(tx, current.id);
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** PLAN-3: duplicate; a booked item becomes "needs booking" with no due date. */
export async function duplicateItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    const src = await repo.loadItemForUpdate(tx, trip.id, itemId);
    if (src.version !== expectedVersion) throw conflict();
    await repo.purgeExpired(tx, trip.id);
    if ((await repo.liveCount(tx, trip.id)) >= ITEM_CAP) throw capError();
    const row = await repo.copyItem(tx, src);
    await bumpTripVersion(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}
