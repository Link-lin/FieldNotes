import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanItemDTO } from "@/shared/dto";
import { isPhoneWidth } from "@/lib/client-value";
import { rememberEventReturn } from "@/lib/event-return";
import type { TripView } from "./TripViewNav/TripViewNav";

type PanelState = { id: string; open: boolean; snapshot: PlanItemDTO; initialEditing: boolean; trigger: string };
type OpenOptions = { editing?: boolean; trigger?: string; replace?: boolean };

/** Desktop panel state and phone event navigation share one event-opening path. */
export function useTripEventPanel({ tripId, items, shown, day, view, initialEvent, closeMenu }: {
  tripId: string;
  items: PlanItemDTO[];
  shown: PlanItemDTO[];
  day: string;
  view: TripView;
  initialEvent: string | null;
  closeMenu: () => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState | null>(null);
  const current = panel ? items.find((candidate) => candidate.id === panel.id) : null;
  // Keep the last known event visible while a refresh or concurrent edit changes its version.
  const item = panel ? (current && current.version >= panel.snapshot.version ? current : panel.snapshot) : null;
  // The open event was deleted elsewhere (TRIP-11): the panel keeps its last view and says so.
  const gone = !!panel && !current;
  const at = item ? shown.findIndex((candidate) => candidate.id === item.id) : -1;

  function open(event: PlanItemDTO, { editing = false, trigger, replace = false }: OpenOptions = {}) {
    closeMenu();
    if (isPhoneWidth()) {
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
      return;
    }
    setPanel({ id: event.id, open: true, snapshot: event, initialEditing: editing, trigger: trigger ?? (editing ? `[data-menu="${event.id}"]` : `[data-details="${event.id}"]`) });
  }

  // Older dashboard links with ?event= open once, then drop the parameter so reload and Back
  // behave as before. A frame also survives development's double mount.
  const arrivingEvent = useRef(initialEvent);
  useEffect(() => {
    const id = arrivingEvent.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      arrivingEvent.current = null;
      const url = new URL(window.location.href);
      url.searchParams.delete("event");
      window.history.replaceState(window.history.state, "", url);
      const event = items.find((candidate) => candidate.id === id);
      if (event) open(event, { replace: true });
    });
    return () => cancelAnimationFrame(frame);
  });

  return {
    panel,
    item,
    gone,
    previous: at > 0 ? (shown[at - 1] ?? null) : null,
    next: at >= 0 ? (shown[at + 1] ?? null) : null,
    open,
    close: () => setPanel((state) => (state ? { ...state, open: false } : state)),
    exited: () => setPanel((state) => (state && !state.open ? null : state)),
    go: (event: PlanItemDTO) => setPanel({ id: event.id, open: true, snapshot: event, initialEditing: false, trigger: view === "bookings" ? `[data-task-open="${event.id}"]` : `[data-details="${event.id}"]` }),
    acceptSaved: (saved: PlanItemDTO) => setPanel((state) => state && state.id === saved.id ? { ...state, snapshot: saved } : state),
  };
}
