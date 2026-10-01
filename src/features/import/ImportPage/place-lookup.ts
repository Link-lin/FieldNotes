import type { ImportLocationCandidate, ImportLocationResult } from "@/shared/import";

export type PlaceLookup = {
  location: string; destination: string; requestId: number;
  status: "loading" | "ready" | "error";
  candidates: ImportLocationCandidate[]; selected: number | null; reviewed: boolean;
};

export function lookupMatches(entry: PlaceLookup | undefined, location: unknown, destination: unknown): boolean {
  return !!entry && typeof location === "string" && typeof destination === "string"
    && entry.location === location.trim() && entry.destination === destination.trim();
}

export function needsLookup(entry: PlaceLookup | undefined, location: unknown, destination: unknown): boolean {
  return !lookupMatches(entry, location, destination) || !entry?.reviewed;
}

/** A superseded batch must not leave excluded rows waiting for discarded responses. */
export function settleLookups(entries: Record<number, PlaceLookup>): Record<number, PlaceLookup> {
  return Object.fromEntries(Object.entries(entries).map(([index, entry]) => [index,
    entry.status === "loading" ? { ...entry, status: "error" as const } : entry]));
}

/** Late responses must not replace a corrected place or a newer request. */
export function finishLookup(entry: PlaceLookup | undefined, requestId: number, result: ImportLocationResult | null): PlaceLookup | undefined {
  if (!entry || entry.requestId !== requestId) return entry;
  if (!result) return { ...entry, status: "error", candidates: [], selected: null };
  const selected = result.suggestedIndex;
  return { ...entry, status: "ready", candidates: result.candidates,
    selected: selected !== null && Number.isInteger(selected) && result.candidates[selected] ? selected : null };
}
