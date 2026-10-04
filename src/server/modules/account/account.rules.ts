import "server-only";
import type { Role } from "@/shared/dto";

/** One accepted person on a trip, as the account-deletion choice sees them. `id` is their grant's id. */
export type Person = { id: string; userId: string; email: string; role: Role; acceptedAt: Date };

const RANK: Record<Role, number> = { owner: 0, editor: 1, viewer: 2 };

/** Earlier acceptance first; the grant id settles a tie so the order never depends on the database. */
const joinedBefore = (a: Person, b: Person) => a.acceptedAt.getTime() - b.acceptedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * An account can hold several grants on one trip (invited under more than one address). It is one person: keep
 * the grant at its highest role, the earliest accepted among equals.
 */
export function onePerAccount(people: Person[]): Person[] {
  const best = new Map<string, Person>();
  for (const p of people) {
    const have = best.get(p.userId);
    if (!have || RANK[p.role] < RANK[have.role] || (RANK[p.role] === RANK[have.role] && joinedBefore(p, have) < 0)) best.set(p.userId, p);
  }
  return [...best.values()];
}

/**
 * The order ownership passes in when an owner leaves (ACCESS-10): owners first, then editors, then viewers, and
 * within a role whoever joined first.
 */
export function successionOrder(people: Person[]): Person[] {
  return onePerAccount(people).sort((a, b) => RANK[a.role] - RANK[b.role] || joinedBefore(a, b));
}
