import "server-only";
import { sql, type Updateable } from "kysely";
import type { Conn, Tx } from "@/server/core/db/client";
import type { TripRow, TripsTable } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";

/** SQL for trips. No access checks here: services call auth/access first. */

/**
 * Trips you created (while still on the allowlist) plus trips with an accepted grant, with the creator's
 * name (none once the creator has deleted their account). `member_role` is the highest role of your accepted
 * grant on the trip, or null for your own trips.
 */
export async function visibleTrips(db: Conn, actor: Actor): Promise<Array<TripRow & { owner_name: string | null; member_role: "viewer" | "editor" | "owner" | null }>> {
  return db
    .selectFrom("trips")
    .leftJoin("User", "User.id", "trips.owner_user_id")
    .selectAll("trips")
    .select("User.name as owner_name")
    .select((eb) =>
      eb
        .selectFrom("trip_viewers")
        .select("trip_viewers.role")
        .whereRef("trip_viewers.trip_id", "=", "trips.id")
        .where("trip_viewers.viewer_user_id", "=", actor.userId)
        .where("trip_viewers.status", "=", "accepted")
        .orderBy(sql`case trip_viewers.role when 'owner' then 2 when 'editor' then 1 else 0 end`, "desc")
        .limit(1)
        .as("member_role"),
    )
    .where((eb) =>
      eb.or([
        eb.and([eb("trips.owner_user_id", "=", actor.userId), eb.val(actor.isOwner)]),
        eb.exists(
          eb
            .selectFrom("trip_viewers")
            .select("trip_viewers.id")
            .whereRef("trip_viewers.trip_id", "=", "trips.id")
            .where("trip_viewers.viewer_user_id", "=", actor.userId)
            .where("trip_viewers.status", "=", "accepted"),
        ),
      ]),
    )
    .orderBy("trips.start_date")
    .execute();
}

export type TripValues = Pick<TripRow, "title" | "destination" | "start_date" | "end_date" | "time_zone" | "budget_amount" | "budget_currency" | "atlas_latitude" | "atlas_longitude" | "atlas_source">;

export async function insertTrip(db: Conn, ownerId: string, values: TripValues): Promise<TripRow> {
  return db.insertInto("trips").values({ ...values, owner_user_id: ownerId }).returningAll().executeTakeFirstOrThrow();
}

/** Updates when the version still matches; undefined means someone else changed it first. */
export async function updateTripRow(tx: Tx, tripId: string, expectedVersion: number, values: Updateable<TripsTable>): Promise<TripRow | undefined> {
  return tx
    .updateTable("trips")
    .set({ ...values, version: sql`version + 1`, updated_at: sql`now()` })
    .where("id", "=", tripId)
    .where("version", "=", expectedVersion)
    .returningAll()
    .executeTakeFirst();
}

/** Every item write bumps the trip version, so stale trip edits are caught. */
export async function bumpTripVersion(tx: Tx, tripId: string): Promise<void> {
  await tx.updateTable("trips").set({ version: sql`version + 1`, updated_at: sql`now()` }).where("id", "=", tripId).execute();
}

/** Deletes the trip (items and grants cascade); import receipts keep their key but lose the link and hash. */
export async function deleteTripRow(tx: Tx, tripId: string): Promise<void> {
  await tx.selectFrom("import_receipts").select("id").where("trip_id", "=", tripId).forUpdate().execute();
  await tx.updateTable("import_receipts").set({ trip_id: null, payload_hash: null }).where("trip_id", "=", tripId).execute();
  await tx.deleteFrom("trips").where("id", "=", tripId).execute();
}
