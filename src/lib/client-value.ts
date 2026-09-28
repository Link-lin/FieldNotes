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

/** Phone widths open an event on its own page instead of the side panel (TRIP-10). Call it only in the browser. */
export function isPhoneWidth(): boolean {
  return window.matchMedia("(max-width: 600px)").matches;
}

/** Today's date on this device (YYYY-MM-DD, local time). Call it only in the browser. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
