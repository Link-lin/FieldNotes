import type { OwnedTripDTO } from "@/shared/dto";

/**
 * What the person chose for one trip they own: "keep" (another owner keeps it), "delete" (for everyone), or
 * the id of the person to make its owner. Person ids are UUIDs, so they never collide with the two words.
 */
export type Choice = string;

/** The decision `DELETE /api/account` takes for a trip (ACCESS-10). */
export type Decision = { tripId: string; action: "delete" } | { tripId: string; action: "transfer"; personId: string };

/** Where a trip starts: with its other owners, else with the next person in line, else deleted (nobody else is on it). */
export function defaultChoice(trip: OwnedTripDTO): Choice {
  if (trip.otherOwners.length) return "keep";
  return trip.people[0]?.id ?? "delete";
}

/** Whether a choice still fits the trip as it is now; people can join, leave or lose access while the dialog is open. */
export function validChoice(trip: OwnedTripDTO, choice: Choice | undefined): choice is Choice {
  if (choice === undefined) return false;
  if (choice === "delete") return true;
  if (choice === "keep") return trip.otherOwners.length > 0;
  return !trip.otherOwners.length && trip.people.some((p) => p.id === choice);
}

/**
 * The decision to send for a choice, or null when the server's own default is what was chosen: a trip other
 * owners keep, or one nobody else is on. Sending nothing for a trip nobody else is on means that if someone
 * joins before the request arrives, the server asks again instead of deleting what they just joined.
 */
export function toDecision(trip: OwnedTripDTO, choice: Choice): Decision | null {
  if (choice === "keep") return null;
  if (choice === "delete") return trip.otherOwners.length || trip.people.length ? { tripId: trip.id, action: "delete" } : null;
  return { tripId: trip.id, action: "transfer", personId: choice };
}

/** "Sam", "Sam and Alex", "Sam, Alex and 2 others". */
export function namesText(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? "" : "s"}`;
}
