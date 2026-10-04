import "server-only";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Role } from "@/shared/dto";
import type { Person } from "./account.rules";

type Conn = Kysely<DB> | Transaction<DB>;

export type OwnedTripRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  owner_user_id: string | null;
  creator_name: string | null;
  creator_email: string | null;
};

/**
 * The trips a person owns: those they created, and those where they hold an accepted owner grant. Pass
 * lock=true inside a transaction to lock them, in start-date order, so the choices made about them cannot
 * race another owner's change.
 */
export async function ownedTripRows(db: Conn, userId: string, lock = false): Promise<OwnedTripRow[]> {
  let q = db
    .selectFrom("trips")
    .leftJoin("User as creator", "creator.id", "trips.owner_user_id")
    .select(["trips.id", "trips.title", "trips.start_date", "trips.end_date", "trips.owner_user_id", "creator.name as creator_name", "creator.email as creator_email"])
    .where((eb) =>
      eb.or([
        eb("trips.owner_user_id", "=", userId),
        eb.exists(
          eb
            .selectFrom("trip_viewers")
            .select("trip_viewers.id")
            .whereRef("trip_viewers.trip_id", "=", "trips.id")
            .where("trip_viewers.viewer_user_id", "=", userId)
            .where("trip_viewers.status", "=", "accepted")
            .where("trip_viewers.role", "=", "owner"),
        ),
      ]),
    )
    .orderBy("trips.start_date")
    .orderBy("trips.id");
  if (lock) q = q.forUpdate("trips");
  return q.execute();
}

/** The accepted grants on these trips other than the given account's, with who and since when. */
export async function acceptedPeople(db: Conn, tripIds: string[], exceptUserId: string): Promise<Array<Person & { tripId: string }>> {
  if (!tripIds.length) return [];
  const rows = await db
    .selectFrom("trip_viewers")
    .select(["id", "trip_id", "invitee_email_normalized", "viewer_user_id", "role", "accepted_at"])
    .where("trip_id", "in", tripIds)
    .where("status", "=", "accepted")
    .where("viewer_user_id", "<>", exceptUserId)
    .orderBy("accepted_at")
    .orderBy("id")
    .execute();
  // Accepted rows always carry a user and an acceptance time (a table check), which the column types can't say.
  return rows.map((r) => ({ id: r.id, tripId: r.trip_id, userId: r.viewer_user_id!, email: r.invitee_email_normalized, role: r.role as Role, acceptedAt: r.accepted_at! }));
}
