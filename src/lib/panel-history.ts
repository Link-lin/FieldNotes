"use client";

// A side panel with an address (the trip page's panels, the dashboard's New trip) holds a history entry over one for its
// page without it, so browser Back closes the panel instead of leaving. That entry carries a mark in its history state,
// so coming back to it (Back or Forward from another page, a reload) reuses it rather than adding another, which would
// drop the entries ahead of it. Next.js keeps custom state on Back, Forward and our own pushState, but a refresh
// replaces it, so the page puts the mark back while its panel holds the entry.
const MARK = "fieldNotesPanel";

/** History state for a panel's entry. */
export const panelEntry = (): Record<string, unknown> => ({ [MARK]: true });

/** Whether the current entry is a panel's, already over an entry for its page without the panel. */
export const isPanelEntry = (): boolean => window.history.state?.[MARK] === true;

/** Puts the mark back on the current entry after the router replaced its state. */
export function keepPanelEntryMark() {
  if (isPanelEntry()) return;
  // The router's own keys are kept, which also tells its patched replaceState to pass this straight through.
  window.history.replaceState({ ...window.history.state, [MARK]: true }, "", window.location.href);
}
