/**
 * What the page is pointing the map at (MAP-5): a stop (the person is on its timeline row or stop-list line), or a
 * day (on its heading, its stop-list label or its tab). The trip page sets it from the same hover and focus events that
 * light a stop's row, line and pin; the map watches it. A store of its own rather than React state, so pointing at
 * things never re-renders the page.
 */
export type MapFocus = { kind: "event"; id: string } | { kind: "day"; day: string };

export type MapFocusStore = {
  get: () => MapFocus | null;
  set: (next: MapFocus | null) => void;
  subscribe: (listener: () => void) => () => void;
};

const same = (a: MapFocus | null, b: MapFocus | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "event" ? a.id === (b as typeof a).id : a.day === (b as typeof a).day;
};

export function createMapFocus(): MapFocusStore {
  let current: MapFocus | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (same(next, current)) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
