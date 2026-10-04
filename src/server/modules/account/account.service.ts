import "server-only";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { ownerEmails } from "@/server/core/env";
import { HttpError, invalid } from "@/server/core/http/errors";
import { setInvitationRole } from "@/server/modules/invitations/invitations.repository";
import { deleteTripRow } from "@/server/modules/trips/trips.repository";
import type { FieldError, OwnedTripDTO } from "@/shared/dto";
import { emailKey } from "@/shared/email";
import { ownedTripDto } from "./account.mapper";
import { acceptedPeople, ownedTripRows, type OwnedTripRow } from "./account.repository";
import { successionOrder, type Person } from "./account.rules";

type Conn = Kysely<DB> | Transaction<DB>;

/** What the person chose for one trip they own. A trip they don't mention stays where it can (see `deleteAccount`). */
export type TripDecision = { tripId: string; action: "delete" } | { tripId: string; action: "transfer"; personId: string };

/** An owned trip, the people on it in the order ownership would pass, and who would keep owning it if the person left. */
type Plan = { trip: OwnedTripRow; people: Person[]; otherOwners: string[] };

async function plans(db: Conn, actor: Actor, lock: boolean): Promise<Plan[]> {
  const trips = await ownedTripRows(db, actor.userId, lock);
  const accepted = await acceptedPeople(db, trips.map((t) => t.id), actor.userId);
  const allowlist = ownerEmails();
  return trips.map((trip) => {
    const people = successionOrder(accepted.filter((p) => p.tripId === trip.id));
    const owners = people.filter((p) => p.role === "owner").map((p) => p.email);
    // The creator keeps the trip too while they can still act as its owner: someone else, with an account, on the allowlist.
    const creatorStays = trip.owner_user_id !== null && trip.owner_user_id !== actor.userId && trip.creator_email !== null && allowlist.has(emailKey(trip.creator_email));
    return { trip, people, otherOwners: creatorStays ? [trip.creator_name?.trim() || trip.creator_email!, ...owners] : owners };
  });
}

/** ACCESS-10: the trips the person owns, for choosing what happens to each when they delete their account. */
export async function listOwnedTrips(db: Kysely<DB>, actor: Actor): Promise<OwnedTripDTO[]> {
  return (await plans(db, actor, false)).map(ownedTripDto);
}

/**
 * ACCESS-10: delete the account after settling every trip the person owns (created, or given the owner role).
 * A trip another owner keeps is left to them. A trip nobody else owns needs a choice when other people are on
 * it: `transfer` makes the chosen person an owner, `delete` deletes the trip for everyone, and with neither the
 * whole request is refused (409) and nothing changes. A trip nobody else is on is deleted. `delete` may also be
 * chosen for a trip another owner would keep. Sessions, sign-in accounts, the person's grants on other trips and
 * their import receipts go with the account; the trips that stay lose only their creator link.
 */
export async function deleteAccount(db: Kysely<DB>, actor: Actor, decisions: TripDecision[] = []): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const owned = await plans(tx, actor, true);
    const choices = new Map(decisions.map((d) => [d.tripId, d]));
    const outOfDate: FieldError[] = [];
    const promote: string[] = [];
    const remove: string[] = [];
    const undecided: OwnedTripRow[] = [];

    for (const id of choices.keys()) {
      if (!owned.some((p) => p.trip.id === id)) outOfDate.push({ path: `trips.${id}`, code: "not_owned", message: "You don't own that trip any more." });
    }
    for (const { trip, people, otherOwners } of owned) {
      const choice = choices.get(trip.id);
      if (choice?.action === "delete") remove.push(trip.id);
      else if (choice?.action === "transfer") {
        const person = people.find((p) => p.id === choice.personId);
        if (!person) outOfDate.push({ path: `trips.${trip.id}`, code: "person_unavailable", message: `That person is no longer on “${trip.title}”. Choose someone else.` });
        else if (person.role !== "owner") promote.push(person.id);
      } else if (otherOwners.length) {
        // Stays with the people who already own it.
      } else if (people.length) undecided.push(trip);
      else remove.push(trip.id); // nobody else is on it
    }

    if (outOfDate.length) throw invalid(outOfDate, "Some of your choices are out of date. Review them and try again.");
    if (undecided.length) {
      const titles = undecided.map((t) => `“${t.title}”`).join(", ");
      throw new HttpError(
        409,
        "account_decision_needed",
        undecided.length === 1
          ? `Choose a new owner for ${titles}, or delete it, before deleting your account.`
          : `Choose a new owner for each of these trips, or delete them, before deleting your account: ${titles}.`,
        undecided.map((t) => ({ path: `trips.${t.id}`, code: "decision_needed", message: "Choose a new owner, or delete this trip." })),
      );
    }

    for (const grantId of promote) await setInvitationRole(tx, grantId, "owner");
    for (const id of remove) await deleteTripRow(tx, id);
    await tx.deleteFrom("User").where("id", "=", actor.userId).execute();
  });
}
