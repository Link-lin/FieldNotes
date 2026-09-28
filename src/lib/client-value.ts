"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A value only the browser knows, such as its time zone or today's local date. The server and the
 * hydrating render use `fallback`, so their markup matches; the browser's value follows at once.
 * `read` must return the same value (or the same cached object) each time it is called.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(noSubscription, read, () => fallback);
}

/** The browser's IANA time zone. Call it only in the browser (for example as a useClientValue reader). */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
