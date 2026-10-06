import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanItemDTO } from "@/shared/dto";
import { isPhoneWidth } from "@/lib/client-value";
import { rememberEventReturn } from "@/lib/event-return";
import { isPanelEntry, keepPanelEntryMark, panelEntry } from "@/lib/panel-history";
import type { PanelGuard } from "./EventPanel/EventPanel";
import type { TripView } from "./TripViewNav/TripViewNav";
import { panelFromSearch, type PanelRequest, type TripFocus } from "./panel-request";

export type { PanelRequest, TripFocus };

type Panel =
  // `fresh`: just added or duplicated here, so not yet among the page's events until the refresh brings it.
  | { kind: "event"; id: string; open: boolean; snapshot: PlanItemDTO; focusTitle: boolean; trigger: string; fresh?: boolean }
  | { kind: "add"; open: boolean; date: string; trigger: string | null }
  | { kind: "trip"; open: boolean; focus: TripFocus; trigger: string | null }
  | { kind: "share"; open: boolean; trigger: string | null };

const PARAMS = ["event", "add", "trip", "share"] as const;

function urlFor(panel: Panel | null): string {
  const url = new URL(window.location.href);
  PARAMS.forEach((p) => url.searchParams.delete(p));
  if (panel?.kind === "event") url.searchParams.set("event", panel.id);
  if (panel?.kind === "add") url.searchParams.set("add", panel.date || "all");
  if (panel?.kind === "trip") url.searchParams.set("trip", panel.focus);
  if (panel?.kind === "share") url.searchParams.set("share", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

const sameKind = (a: PanelRequest | null, b: Panel | null) => !!a && !!b && a.kind === b.kind && (a.kind !== "event" || (b.kind === "event" && a.id === b.id));

/**
 * The trip page's side panels (TRIP-1, TRIP-9, TRIP-10, DASH-6, ACCESS-3): an event, a new event, the trip's details
 * or sharing. Each has an address, so reload restores it and links can point at it. Opening one adds a history entry,
 * so browser Back closes it (asking first about unsaved changes); arriving at one puts an entry for the page without it
 * underneath, so Back closes it there too rather than leaving the page, and coming back to a panel's entry (Back or
 * Forward from another page, a reload) reuses it (`panel-history.ts`); moving within a panel (Previous and Next, a new
 * event once added) replaces the entry. On phones an event opens as its own page instead (TRIP-10).
 */

/** How a panel came to open: from the page (no value), from the page's address on arrival, or by Back or Forward. */
type From = "address" | "history";
export function useTripPanels({ tripId, items, shown, day, view, allows, closeMenu }: {
  tripId: string;
  items: PlanItemDTO[];
  shown: PlanItemDTO[];
  day: string;
  view: TripView;
  /** Whether this person may use a panel the address asks for. */
  allows: (want: PanelRequest) => boolean;
  closeMenu: () => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  // Whether this page added the open panel's history entry, so closing it goes Back instead of leaving one behind.
  const pushed = useRef(false);
  const guard = useRef<PanelGuard | null>(null);
  const live = useRef({ panel, items });
  useEffect(() => {
    live.current = { panel, items };
  });

  const current = panel?.kind === "event" ? items.find((candidate) => candidate.id === panel.id) : undefined;
  // Keep the last known event visible while a refresh or concurrent edit changes its version.
  const item = panel?.kind === "event" ? (current && current.version >= panel.snapshot.version ? current : panel.snapshot) : null;
  // The open event was deleted elsewhere (TRIP-11): the panel keeps its last view and says so.
  const gone = panel?.kind === "event" && !current && !panel.fresh;
  // A new or duplicated event has arrived with the refresh; from now on its absence means it was deleted.
  if (panel?.kind === "event" && panel.fresh && current) setPanel({ ...panel, fresh: false });
  const at = item ? shown.findIndex((candidate) => candidate.id === item.id) : -1;

  function show(next: Panel, history: "push" | "replace" | "arrive" | "none") {
    setPanel(next);
    if (history === "none") return;
    const url = urlFor(next);
    if (history === "arrive") window.history.replaceState(null, "", urlFor(null));
    if (history === "push" || history === "arrive") {
      window.history.pushState(panelEntry(), "", url);
      pushed.current = true;
    } else window.history.replaceState(pushed.current ? panelEntry() : null, "", url);
  }
  // A panel replaces one that is open, or its own entry that Back, Forward or a reload came back to; arriving at its
  // address afresh, it goes over an entry for the page without it; otherwise it adds a history entry.
  const how = (from?: From) => (from === "address" ? "arrive" : from === "history" || live.current.panel?.open ? "replace" : "push");

  function phoneEvent(event: PlanItemDTO, editing: boolean, replace: boolean) {
    const query = new URLSearchParams();
    if (view === "bookings") query.set("view", "bookings");
    else if (day !== "all") query.set("day", day);
    if (editing) query.set("edit", "1");
    const href = `/trips/${tripId}/items/${event.id}${query.size ? `?${query}` : ""}`;
    if (replace) router.replace(href);
    else {
      rememberEventReturn(tripId, event.id);
      router.push(href);
    }
  }

  function openEvent(event: PlanItemDTO, { focusTitle = false, trigger, from }: { focusTitle?: boolean; trigger?: string; from?: From } = {}) {
    closeMenu();
    if (isPhoneWidth()) return phoneEvent(event, focusTitle, !!from);
    show({ kind: "event", id: event.id, open: true, snapshot: event, focusTitle, trigger: trigger ?? (focusTitle ? `[data-menu="${event.id}"]` : `[data-details="${event.id}"]`) }, how(from));
  }
  function openAdd(date: string, trigger: string | null, from?: From) {
    closeMenu();
    show({ kind: "add", open: true, date, trigger }, how(from));
  }
  function openTrip(focus: TripFocus, trigger: string | null, from?: From) {
    show({ kind: "trip", open: true, focus, trigger }, how(from));
  }
  function openShare(trigger: string | null, from?: From) {
    show({ kind: "share", open: true, trigger }, how(from));
  }
  function openRequest(want: PanelRequest, from: From) {
    if (want.kind === "event") {
      const event = live.current.items.find((candidate) => candidate.id === want.id);
      if (event) openEvent(event, { focusTitle: want.focusTitle, from });
      else window.history.replaceState(null, "", urlFor(null));
    } else if (want.kind === "add") openAdd(want.date, null, from);
    else if (want.kind === "trip") openTrip(want.focus, null, from);
    else openShare(null, from);
  }

  // Resolves close() once its Back has landed, so a refresh started after it can't overlap the history change.
  const closing = useRef<(() => void) | null>(null);
  /** Closes the open panel (it has already asked about anything unsaved). */
  function close(): Promise<void> {
    setPanel((state) => (state ? { ...state, open: false } : state));
    if (!pushed.current) {
      window.history.replaceState(null, "", urlFor(null));
      return Promise.resolve();
    }
    pushed.current = false;
    return new Promise((resolve) => {
      const done = () => {
        if (closing.current === done) closing.current = null;
        resolve();
      };
      closing.current = done;
      window.history.back();
      setTimeout(done, 600);
    });
  }

  // The address asked for a panel (a link, a reload, a dashboard card's menu): open it once, or drop it from the address
  // if this person can't use it. A frame also survives development's double mount.
  const arriving = useRef(true);
  useEffect(() => {
    if (!arriving.current) return;
    const frame = requestAnimationFrame(() => {
      arriving.current = false;
      const want = panelFromSearch(window.location.search);
      if (want && allows(want)) {
        // Back to this panel's own entry from another page, or a reload of it: the entry for the page is already under it.
        if (isPanelEntry()) pushed.current = true;
        openRequest(want, isPanelEntry() ? "history" : "address");
      } else if (want) window.history.replaceState(null, "", urlFor(null));
    });
    return () => cancelAnimationFrame(frame);
  });

  // Browser Back and Forward: a panel whose entry is left closes (or stays, asking about unsaved changes); arriving on
  // a panel's entry opens it. The listener is added once: the router re-renders the page while the event is being
  // dispatched, and a listener added again then would miss it.
  const reopen = useRef(openRequest);
  useEffect(() => {
    reopen.current = openRequest;
  });
  useEffect(() => {
    const onPop = () => {
      if (closing.current) return closing.current();
      const want = panelFromSearch(window.location.search);
      const open = live.current.panel?.open ? live.current.panel : null;
      if (open && !sameKind(want, open)) {
        if (guard.current && !guard.current()) {
          // Unsaved changes: the panel keeps its entry and asks.
          window.history.pushState(panelEntry(), "", urlFor(open));
          pushed.current = true;
          return;
        }
        pushed.current = false;
        setPanel((state) => (state ? { ...state, open: false } : state));
        return;
      }
      if (!open && want) {
        pushed.current = true;
        reopen.current(want, "history");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // A refresh (after a save, or a change made elsewhere) replaces the entry's history state: keep the panel's mark on it.
  useEffect(() => {
    if (panel?.open && pushed.current && sameKind(panelFromSearch(window.location.search), panel)) keepPanelEntryMark();
  });

  return {
    panel,
    item,
    gone,
    guard,
    previous: at > 0 ? (shown[at - 1] ?? null) : null,
    next: at >= 0 ? (shown[at + 1] ?? null) : null,
    openEvent,
    openAdd,
    openTrip,
    openShare,
    close,
    exited: () => setPanel((state) => (state && !state.open ? null : state)),
    /** Shows another event in the open panel; `fresh` for one just made here (a duplicate). */
    go: (event: PlanItemDTO, fresh = false) => show({ kind: "event", id: event.id, open: true, snapshot: event, focusTitle: false, fresh, trigger: view === "bookings" ? `[data-task-open="${event.id}"]` : `[data-details="${event.id}"]` }, "replace"),
    acceptSaved: (saved: PlanItemDTO) => setPanel((state) => (state?.kind === "event" && state.id === saved.id ? { ...state, snapshot: saved } : state)),
    /** A new event was added from the add panel: show it there (on phones, as its page). */
    created: (saved: PlanItemDTO) => {
      if (isPhoneWidth()) {
        setPanel(null);
        pushed.current = false;
        rememberEventReturn(tripId, saved.id);
        router.replace(`/trips/${tripId}/items/${saved.id}${day !== "all" ? `?day=${encodeURIComponent(day)}` : ""}`);
        return;
      }
      show({ kind: "event", id: saved.id, open: true, snapshot: saved, focusTitle: false, fresh: true, trigger: `[data-details="${saved.id}"]` }, "replace");
    },
  };
}
