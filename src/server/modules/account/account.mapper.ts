import "server-only";
import type { OwnedTripDTO } from "@/shared/dto";
import type { OwnedTripRow } from "./account.repository";
import type { Person } from "./account.rules";

/** A trip the person owns, with who else is on it and who would keep owning it, for the account-deletion choice. */
export function ownedTripDto({ trip, people, otherOwners }: { trip: OwnedTripRow; people: Person[]; otherOwners: string[] }): OwnedTripDTO {
  return {
    id: trip.id,
    title: trip.title,
    startDate: trip.start_date,
    endDate: trip.end_date,
    otherOwners,
    people: people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
  };
}
