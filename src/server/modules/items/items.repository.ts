import "server-only";
import { sql } from "kysely";
import type { Conn, Tx } from "@/server/core/db/client";
import type { PlanItemRow } from "@/server/core/db/schema";
import { notFound } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import type { Values } from "./items.rules";

/** SQL for plan items. No access checks here: services call auth/access first. */

/** Permanently removes deletions older than the 10-minute restore window. */
export async function purgeExpired(tx: Tx, tripId: string): Promise<void> {
  await tx.deleteFrom("plan_items").where("trip_id", "=", tripId).where("deleted_at", "<", sql<Date>`now() - interval '10 minutes'`).execute();
}

export async function liveCount(tx: Tx, tripId: string): Promise<number> {
  const r = await tx.selectFrom("plan_items").select((eb) => eb.fn.countAll<number>().as("n")).where("trip_id", "=", tripId).where("deleted_at", "is", null).executeTakeFirst();
  return Number(r?.n ?? 0);
}

/** Locks and returns one item of the trip; 404 when missing (or deleted, unless asked). */
export async function loadItemForUpdate(tx: Tx, tripId: string, itemId: string, includeDeleted = false): Promise<PlanItemRow> {
  if (!isUuid(itemId)) throw notFound();
  let q = tx.selectFrom("plan_items").selectAll().where("id", "=", itemId).where("trip_id", "=", tripId).forUpdate();
  if (!includeDeleted) q = q.where("deleted_at", "is", null);
  const row = await q.executeTakeFirst();
  if (!row) throw notFound();
  return row;
}

/** Locks and returns these undeleted items of the trip; 404 when any is missing or deleted. */
export async function loadItemsForUpdate(tx: Tx, tripId: string, itemIds: string[]): Promise<PlanItemRow[]> {
  if (!itemIds.length || !itemIds.every(isUuid)) throw notFound();
  const rows = await tx.selectFrom("plan_items").selectAll().where("trip_id", "=", tripId).where("id", "in", itemIds).where("deleted_at", "is", null).forUpdate().execute();
  if (rows.length !== new Set(itemIds).size) throw notFound();
  return rows;
}

/** Marks AI drafts reviewed (a time) or unreviewed (null). */
export async function setReviewed(tx: Tx, itemIds: string[], reviewedAt: Date | null): Promise<PlanItemRow[]> {
  return tx
    .updateTable("plan_items")
    .set({ reviewed_at: reviewedAt, version: sql`version + 1`, updated_at: sql`now()` })
    .where("id", "in", itemIds)
    .returningAll()
    .execute();
}

/** One undeleted item of the trip, without a lock; 404 when missing. */
export async function liveItem(db: Conn, tripId: string, itemId: string): Promise<PlanItemRow> {
  if (!isUuid(itemId)) throw notFound();
  const row = await db.selectFrom("plan_items").selectAll().where("id", "=", itemId).where("trip_id", "=", tripId).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) throw notFound();
  return row;
}

export async function liveItems(db: Conn, tripId: string): Promise<PlanItemRow[]> {
  return db.selectFrom("plan_items").selectAll().where("trip_id", "=", tripId).where("deleted_at", "is", null).execute();
}

export async function insertItem(tx: Tx, tripId: string, source: "manual" | "ai", values: Values): Promise<PlanItemRow> {
  return tx.insertInto("plan_items").values({ ...values, trip_id: tripId, source }).returningAll().executeTakeFirstOrThrow();
}

/** Updates when the version still matches; undefined means someone else changed it first. */
export async function updateItemRow(tx: Tx, itemId: string, expectedVersion: number, values: Values): Promise<PlanItemRow | undefined> {
  return tx
    .updateTable("plan_items")
    .set({ ...values, version: sql`version + 1`, updated_at: sql`now()` })
    .where("id", "=", itemId)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirst();
}

/** Notes only, when the version still matches; undefined means someone else changed it first. */
export async function updateNotes(tx: Tx, itemId: string, expectedVersion: number, notes: string | null): Promise<PlanItemRow | undefined> {
  return tx
    .updateTable("plan_items")
    .set({ notes, version: sql`version + 1`, updated_at: sql`now()` })
    .where("id", "=", itemId)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirst();
}

/** Booking state and book-by date only, when the version still matches; undefined means someone else changed it first. */
export async function updateBooking(tx: Tx, itemId: string, expectedVersion: number, status: "needs_booking" | "booked", dueDate: string | null): Promise<PlanItemRow | undefined> {
  return tx
    .updateTable("plan_items")
    .set({ booking_status: status, booking_due_date: dueDate, version: sql`version + 1`, updated_at: sql`now()` })
    .where("id", "=", itemId)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirst();
}

export async function softDelete(tx: Tx, itemId: string): Promise<void> {
  await tx.updateTable("plan_items").set({ deleted_at: sql`now()`, version: sql`version + 1` }).where("id", "=", itemId).execute();
}

/** Undefined when the row is gone (purged by the database clock in the same transaction). */
export async function undelete(tx: Tx, itemId: string): Promise<PlanItemRow | undefined> {
  return tx.updateTable("plan_items").set({ deleted_at: null, version: sql`version + 1` }).where("id", "=", itemId).returningAll().executeTakeFirst();
}

/** A copy of the row with a new id and timestamps; a booked copy becomes "needs booking" without a due date. */
export async function copyItem(tx: Tx, src: PlanItemRow): Promise<PlanItemRow> {
  const { id: _id, version: _v, created_at: _c, updated_at: _u, deleted_at: _d, links, ...rest } = src;
  void _id; void _v; void _c; void _u; void _d;
  return tx
    .insertInto("plan_items")
    .values({
      ...rest,
      links: JSON.stringify(links),
      booking_status: src.booking_status === "booked" ? "needs_booking" : src.booking_status,
      booking_due_date: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Undeleted inherited-zone timed items: the ones a trip time-zone change reinterprets. */
export async function inheritedTimedItems(db: Conn, tripId: string) {
  return db
    .selectFrom("plan_items")
    .select(["id", "title", "local_date", "local_time", "time_disambiguation"])
    .where("trip_id", "=", tripId)
    .where("deleted_at", "is", null)
    .where("type", "<>", "flight")
    .where("time_zone", "is", null)
    .where("local_time", "is not", null)
    .execute();
}

export async function setTimeDisambiguation(tx: Tx, itemId: string, value: "earlier" | "later" | null): Promise<void> {
  await tx.updateTable("plan_items").set({ time_disambiguation: value, version: sql`version + 1`, updated_at: sql`now()` }).where("id", "=", itemId).execute();
}

/** Items still to book in the given trips (id, trip, title, due date). */
export async function openBookingItems(db: Conn, tripIds: string[], withDueDateOnly = false) {
  if (!tripIds.length) return [];
  let q = db
    .selectFrom("plan_items")
    .select(["id", "trip_id", "title", "booking_due_date"])
    .where("trip_id", "in", tripIds)
    .where("booking_status", "=", "needs_booking")
    .where("deleted_at", "is", null);
  if (withDueDateOnly) q = q.where("booking_due_date", "is not", null).orderBy("booking_due_date");
  return q.execute();
}
