import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";

/*
 * Live updates (TRIP-11): what changed between two loads of a trip, so the page can light up the rows that changed
 * elsewhere (a connected chat, another tab, a person the trip is shared with) and say so in one short note.
 */

export type LiveChanges = { added: string[]; changed: string[]; pinned: string[]; removed: string[] };

/** An item without what a new map pin alone changes, to tell "pinned on the map" from other edits. */
function withoutPin(i: PlanItemDTO) {
  const { version: _v, updatedAt: _u, mapUrl: _m, mapProvider: _p, coordinates: _c, ...rest } = i;
  void _v; void _u; void _m; void _p; void _c;
  return JSON.stringify(rest);
}

export function liveChanges(before: readonly PlanItemDTO[], after: readonly PlanItemDTO[]): LiveChanges {
  const old = new Map(before.map((i) => [i.id, i]));
  const now = new Set(after.map((i) => i.id));
  const out: LiveChanges = { added: [], changed: [], pinned: [], removed: before.filter((i) => !now.has(i.id)).map((i) => i.id) };
  for (const i of after) {
    const was = old.get(i.id);
    if (!was) out.added.push(i.id);
    else if (i.version !== was.version) {
      const justPinned = !was.coordinates && !!i.coordinates && withoutPin(was) === withoutPin(i);
      (justPinned ? out.pinned : out.changed).push(i.id);
    }
  }
  return out;
}

const count = (n: number, noun: boolean) => (noun ? `${n} ${n === 1 ? "event" : "events"}` : String(n));

/** One short note for a change made elsewhere, or null when nothing a person would notice changed. */
export function changesMessage(c: LiveChanges, before: TripDetailDTO["trip"], after: TripDetailDTO["trip"]): string | null {
  if (before.role !== after.role) {
    return after.role === "viewer" ? "You can now only view this trip." : after.role === "owner" ? "You are now an owner of this trip." : "You can now edit this trip's events.";
  }
  const parts: string[] = [];
  for (const [ids, word] of [[c.added, "added"], [c.changed, "changed"], [c.pinned, "pinned on the map"], [c.removed, "removed"]] as const) {
    if (ids.length) parts.push(`${count(ids.length, parts.length === 0)} ${word}`);
  }
  if (parts.length) return `Trip updated: ${parts.join(", ")}.`;
  const tripChanged = before.title !== after.title || before.destination !== after.destination || before.startDate !== after.startDate || before.endDate !== after.endDate || before.timeZone !== after.timeZone || JSON.stringify(before.budget) !== JSON.stringify(after.budget);
  return tripChanged ? "Trip updated." : null;
}
