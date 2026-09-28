"use client";

// A phone event opened from a trip has one return entry in browser history. Keep only identifiers
// in memory; a direct or reloaded event URL falls back to its trip address.
let openedFromTrip: { tripId: string; itemId: string } | null = null;

export function rememberEventReturn(tripId: string, itemId: string) {
  openedFromTrip = { tripId, itemId };
}

export function replaceEventReturn(tripId: string, itemId: string) {
  if (openedFromTrip?.tripId === tripId) openedFromTrip = { tripId, itemId };
}

export function takeEventReturn(tripId: string, itemId: string): boolean {
  const matches = openedFromTrip?.tripId === tripId && openedFromTrip.itemId === itemId;
  openedFromTrip = null;
  return matches;
}

export function clearEventReturn() {
  openedFromTrip = null;
}
