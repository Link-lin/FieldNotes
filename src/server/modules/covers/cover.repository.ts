import "server-only";
import { sql } from "kysely";
import type { Conn, Tx } from "@/server/core/db/client";
import type { TripRow } from "@/server/core/db/schema";
import { updateTripRow } from "@/server/modules/trips/trips.repository";

/** SQL for trip covers (DASH-8). No access checks here: the cover service calls auth/access first. */

export type StoredCover = { hash: string; width: number; height: number; full: Buffer; small: Buffer };

/** Stores the cover's two images and its trip columns; undefined when the trip's version moved first. */
export async function saveCover(tx: Tx, tripId: string, expectedVersion: number, cover: StoredCover): Promise<TripRow | undefined> {
  await tx
    .insertInto("trip_covers")
    .values({ trip_id: tripId, full_jpeg: cover.full, small_jpeg: cover.small })
    .onConflict((oc) => oc.column("trip_id").doUpdateSet({ full_jpeg: cover.full, small_jpeg: cover.small, created_at: sql`now()` }))
    .execute();
  return updateTripRow(tx, tripId, expectedVersion, { cover_hash: cover.hash, cover_width: cover.width, cover_height: cover.height });
}

/** Removes the cover and clears its trip columns; undefined when the trip's version moved first. */
export async function deleteCover(tx: Tx, tripId: string, expectedVersion: number): Promise<TripRow | undefined> {
  await tx.deleteFrom("trip_covers").where("trip_id", "=", tripId).execute();
  return updateTripRow(tx, tripId, expectedVersion, { cover_hash: null, cover_width: null, cover_height: null });
}

/** One of the cover's two images, the only query that reads their bytes. */
export async function coverImage(db: Conn, tripId: string, size: "full" | "small"): Promise<Buffer | null> {
  const row = await db
    .selectFrom("trip_covers")
    .select(sql<Buffer>`${sql.ref(size === "full" ? "full_jpeg" : "small_jpeg")}`.as("bytes"))
    .where("trip_id", "=", tripId)
    .executeTakeFirst();
  return row?.bytes ?? null;
}
