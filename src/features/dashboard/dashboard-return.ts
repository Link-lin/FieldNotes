/**
 * Remembers where the dashboard was (filter URL, scroll, which trip was opened) so Back or
 * "All trips" can restore it and focus the trip's card entry point (TRIP-1).
 */
export const DASH_RETURN_KEY = "fn.dashboard-return";

type Saved = { url?: string; trip?: string; booking?: boolean; y?: number; list?: number };

/** On desktop the page doesn't scroll; the dashboard's left column does. */
export function innerScroller(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>("[data-dash-scroll]");
  return el && getComputedStyle(el).overflowY === "auto" ? el : null;
}

export function rememberReturn(tripId: string, booking = false) {
  try {
    const saved: Saved = { url: window.location.pathname + window.location.search, trip: tripId, booking, y: window.scrollY, list: innerScroller()?.scrollTop ?? 0 };
    sessionStorage.setItem(DASH_RETURN_KEY, JSON.stringify(saved));
  } catch {}
}

/** Reads and clears the saved position. */
export function takeReturn(): Saved | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DASH_RETURN_KEY) ?? "null") as Saved | null;
    sessionStorage.removeItem(DASH_RETURN_KEY);
    return saved;
  } catch {
    return null;
  }
}

/** The dashboard address to go back to, with its filter; "/" when unknown. */
export function dashboardUrl(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DASH_RETURN_KEY) ?? "null") as Saved | null;
    if (saved?.url && saved.url.startsWith("/") && !saved.url.startsWith("//")) return saved.url;
  } catch {}
  return "/";
}
