"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { useToast } from "@/components/ui/Toast/Toast";
import { dashboardUrl } from "@/features/dashboard/dashboard-return";
import { ItemForm } from "@/features/trips/ItemForm/ItemForm";
import { TripForm } from "@/features/trips/TripForm/TripForm";
import { api, lastWriteAt } from "@/lib/api";
import { clearEventReturn } from "@/lib/event-return";
import { fmtDay } from "@/lib/format";
import { useLiveRevision } from "@/lib/use-live-revision";
import { isAiDraft } from "@/shared/drafts";
import { tripRevision } from "@/shared/revision";
import { canEdit as mayEdit, canManage as mayManage } from "@/shared/roles";
import { AddFab } from "./AddFab/AddFab";
import { BookingList } from "./BookingList/BookingList";
import { CostsSection } from "./CostsSection/CostsSection";
import { DaySection, SubHeading, TodayMark } from "./DaySection/DaySection";
import { DraftsNote } from "./DraftsNote/DraftsNote";
import { EventPanel } from "./EventPanel/EventPanel";
import { DayTabs } from "./DayTabs/DayTabs";
import { GlobeLocation } from "./GlobeLocation/GlobeLocation";
import { MapPanel } from "./MapPanel/MapPanel";
import { createMapFocus } from "./MapPanel/map-focus";
import { pointing } from "./MapPanel/pointing";
import { RecentlyDeleted } from "./RecentlyDeleted/RecentlyDeleted";
import { ShareDialog } from "./ShareDialog/ShareDialog";
import { Timeline } from "./Timeline/Timeline";
import { TripHeader } from "./TripHeader/TripHeader";
import { TripHighlights } from "./TripHighlights/TripHighlights";
import { TripViewNav, type TripView } from "./TripViewNav/TripViewNav";
import { dayNumber, isOutside, pad2, tripDays, tripStops } from "./trip-days";
import { changesMessage, liveChanges } from "./live-changes";
import { REVIEW_CHANGED, sendReview } from "./review-events";
import styles from "./TripPage.module.css";
import { animateDayEnter } from "./day-motion";
import { useTripEventPanel } from "./useTripEventPanel";

const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
const LIT = "data-lit";
/** A change that lands this soon after this tab saved something is taken to be its own (it says so itself). */
const OWN_CHANGE_MS = 2500;
/** How long rows changed elsewhere stay lit. */
const FRESH_MS = 2400;

type ItemFormState = { item: PlanItemDTO | null; date: string; trigger: string | null };

/**
 * A trip on its own page (TRIP-1 to TRIP-10): header, highlights, day tabs, timeline and map,
 * costs, bookings and globe location. This component holds the page state and actions; each part
 * renders itself.
 */
export function TripPage({ data, initialDay, initialEvent, initialView, mapsKey, canEmail }: { data: TripDetailDTO; initialDay: string | null; initialEvent: string | null; initialView: TripView; mapsKey: string | null; canEmail: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { trip, items } = data;
  const canEdit = mayEdit(trip.role); // events, bookings and notes
  const canManage = mayManage(trip.role); // the trip itself, sharing and deletion

  // TRIP-11: the page follows changes made elsewhere (a connected chat, another tab, people it is shared with) on its own.
  useLiveRevision(`/api/trips/${trip.id}/revision`, tripRevision(trip));

  const { byDate, inRange, days } = useMemo(() => tripDays(trip, items), [trip, items]);
  const undated = items.filter((i) => !i.timelineDate && !i.flightDetails);
  const undatedFlights = items.filter((i) => !i.timelineDate && i.flightDetails);
  const [picked, setDay] = useState<string>(initialDay ?? "all");
  const [view, setView] = useState<TripView>(initialView);
  // Browser Back from a phone event returns to this page without consuming the in-memory marker.
  useEffect(() => clearEventReturn(), []);
  // A day can vanish after a refresh (its last out-of-range event moved); fall back to Whole trip.
  const day = picked === "all" || days.includes(picked) ? picked : "all";
  const all = day === "all";

  // Stop numbers run across the whole trip; a day tab shows the same numbers (TRIP-2).
  const allStops = useMemo(() => tripStops(trip, byDate, days), [trip, byDate, days]);
  const stops = all ? allStops : allStops.filter((s) => s.day === day);
  const numbers = new Map(allStops.map((s) => [s.id, { n: s.n, need: s.need }]));
  const toBook = items.filter((i) => i.bookingStatus === "needs_booking");
  const overdueCount = toBook.filter((i) => i.bookingDueState === "overdue").length;

  const [editingTrip, setEditingTrip] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Deleted this visit and still restorable, so Undo stays reachable after the toast closes.
  const [recentlyDeleted, setRecentlyDeleted] = useState<PlanItemDTO[]>([]);

  // Animate the timeline in from the side of the newly chosen tab (later days from the right).
  const mainRef = useRef<HTMLDivElement>(null);
  const shownDay = useRef(day);
  useLayoutEffect(() => {
    const from = shownDay.current;
    shownDay.current = day;
    if (from === day || !mainRef.current) return;
    const order = ["all", ...days];
    animateDayEnter(mainRef.current, Math.sign(order.indexOf(day) - order.indexOf(from)));
  }, [day, days]);

  function selectDay(d: string, focus: boolean) {
    setDay(d);
    const url = new URL(window.location.href);
    if (d === "all") url.searchParams.delete("day");
    else url.searchParams.set("day", d);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${d}`)?.focus());
  }

  function selectView(next: TripView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "bookings") url.searchParams.set("view", "bookings");
    else url.searchParams.delete("view");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  // Escape returns to the dashboard when nothing else wants it (TRIP-1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isField(e.target)) return;
      if (document.querySelector("[data-modal], [role=menu]:not([hidden]), [data-toast]")) return;
      router.push(dashboardUrl());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  // Linked highlight: hovering or focusing a row, a stop line or a pin lights all three (MAP-5). The same events,
  // on a row, a stop line, a day heading, a day label in the stop list or a day tab, point the map at that stop or day.
  const root = useRef<HTMLDivElement>(null);
  const [mapFocus] = useState(createMapFocus);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // A marker for several stops at nearly one place also lights for each of them (data-hl-also).
    const set = (id: string, on: boolean) => el.querySelectorAll(`[data-hl="${CSS.escape(id)}"], [data-hl-also~="${CSS.escape(id)}"]`).forEach((x) => x.toggleAttribute(LIT, on));
    const over = (e: Event) => {
      const { light, look } = pointing({ type: e.type, target: e.target as Element, relatedTarget: (e as MouseEvent | FocusEvent).relatedTarget }, window.matchMedia("(any-hover: hover)").matches);
      if (light) set(light.id, light.on);
      if (look !== undefined) mapFocus.set(look);
    };
    const kinds = ["mouseover", "mouseout", "focusin", "focusout"];
    kinds.forEach((t) => el.addEventListener(t, over));
    return () => kinds.forEach((t) => el.removeEventListener(t, over));
  }, [mapFocus]);

  const rowOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-timeline] [data-hl="${CSS.escape(id)}"]`) ?? null;

  // What a refresh brought that this tab didn't do itself: light those rows and stop lines for a moment, and say what changed.
  const loaded = useRef(data);
  useEffect(() => {
    const before = loaded.current;
    loaded.current = data;
    if (before === data || Date.now() - lastWriteAt() < OWN_CHANGE_MS) return;
    const changes = liveChanges(before.items, data.items);
    const message = changesMessage(changes, before.trip, data.trip);
    if (message) toast({ message, quiet: true });
    const lit = [...changes.added, ...changes.changed, ...changes.pinned].flatMap((id) => [...(root.current?.querySelectorAll<HTMLElement>(`[data-hl="${CSS.escape(id)}"]:not([data-pin])`) ?? [])]);
    lit.forEach((el) => el.toggleAttribute(LIT, true));
    const off = () => lit.forEach((el) => el.toggleAttribute(LIT, false));
    const t = setTimeout(off, FRESH_MS);
    return () => {
      clearTimeout(t);
      off();
    };
  }, [data, toast]);

  function goToEvent(id: string) {
    const row = rowOf(id);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.toggleAttribute(LIT, true);
    setTimeout(() => row.toggleAttribute(LIT, false), 1600);
  }

  // After a delete, focus goes to the next event's menu, else the day's add row (TRIP-8).
  function nextFocusAfter(id: string): string {
    const row = rowOf(id);
    const sib = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null;
    const k = sib?.querySelector<HTMLElement>("[data-menu]");
    if (k) return `[data-menu="${k.dataset.menu}"]`;
    const add = row?.closest("section")?.querySelector<HTMLElement>("[data-add-day]");
    return add ? `[data-add-day="${add.dataset.addDay}"]` : "#trip-title";
  }

  async function restoreEvent(item: PlanItemDTO) {
    const back = await api<PlanItemDTO>("POST", `/api/trips/${trip.id}/items/${item.id}/restore`);
    setRecentlyDeleted((l) => l.filter((x) => x.id !== item.id));
    if (!back.ok) {
      toast({ message: back.status === 410 ? `"${item.title}" can no longer be restored.` : back.message });
      return;
    }
    router.refresh();
    toast({ message: "Event restored." });
    setTimeout(() => document.querySelector<HTMLElement>(`[data-menu="${item.id}"]`)?.focus(), 300);
  }

  async function deleteEvent(item: PlanItemDTO) {
    setMenuFor(null);
    const after = nextFocusAfter(item.id);
    const r = await api<void>("DELETE", `/api/trips/${trip.id}/items/${item.id}`, { expectedVersion: item.version });
    if (!r.ok) {
      toast({ message: r.message });
      return;
    }
    router.refresh();
    setRecentlyDeleted((l) => [item, ...l.filter((x) => x.id !== item.id)].slice(0, 10));
    toast({ message: "Event deleted.", actionLabel: "Undo", afterFocus: after, onAction: () => restoreEvent(item) });
  }

  // IMPORT-7: events the person has checked lose the AI draft tag; one at a time, or every draft at once, with Undo.
  const drafts = items.filter(isAiDraft);
  const [reviewing, setReviewing] = useState(false);
  async function review(list: PlanItemDTO[], reviewed: boolean): Promise<PlanItemDTO[] | null> {
    const r = await sendReview(trip.id, list, reviewed);
    router.refresh();
    if (!r.ok) {
      toast({ message: r.status === 409 ? REVIEW_CHANGED : r.message });
      return null;
    }
    r.data.forEach((saved) => eventPanel.acceptSaved(saved));
    return r.data;
  }
  async function reviewEvents(list: PlanItemDTO[], afterFocus?: string) {
    setMenuFor(null);
    setReviewing(true);
    const saved = await review(list, true);
    setReviewing(false);
    if (!saved) return;
    const one = saved.length === 1;
    toast({
      message: one ? `"${saved[0]!.title}" marked as reviewed.` : `${saved.length} events marked as reviewed.`,
      actionLabel: "Undo",
      afterFocus,
      onAction: () => void review(saved, false).then((back) => back && toast({ message: one ? "It is an AI draft again." : `${back.length} events are AI drafts again.` })),
    });
  }

  async function duplicateEvent(item: PlanItemDTO) {
    setMenuFor(null);
    const r = await api<PlanItemDTO>("POST", `/api/trips/${trip.id}/items/${item.id}/duplicate`, { expectedVersion: item.version });
    toast({ message: r.ok ? "Event duplicated." : r.message });
    if (r.ok) router.refresh();
    document.querySelector<HTMLElement>(`[data-menu="${item.id}"]`)?.focus();
  }

  // A new price defaults to the currency last used on this trip, then the trip budget, then the owner's latest.
  const lastPriced = [...items].filter((i) => i.plannedPrice).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const defaultCurrency = lastPriced?.plannedPrice?.currency ?? trip.budget?.currency ?? data.recentCurrencies[0] ?? "USD";
  const openAdd = (date: string, trigger: string | null) => setItemForm({ item: null, date, trigger });

  // Events in the order the current tab shows them, for the panel's Previous and Next.
  const shown = view === "bookings" ? [...toBook].sort((a, b) => (a.bookingDueDate ?? "9999").localeCompare(b.bookingDueDate ?? "9999")) : [
    ...(all ? days : [day]).flatMap((d) => {
      const list = byDate.get(d) ?? [];
      return [...list.filter((i) => i.sortInstant), ...list.filter((i) => !i.sortInstant)];
    }),
    ...(all ? [...undatedFlights, ...undated] : []),
  ];
  const eventPanel = useTripEventPanel({
    tripId: trip.id,
    items,
    shown,
    day,
    view,
    initialEvent,
    closeMenu: () => setMenuFor(null),
  });

  const timeline = (list: PlanItemDTO[], numbered: boolean) => (
    <Timeline
      items={list}
      numbers={numbered ? numbers : null}
      canEdit={canEdit}
      tripZone={trip.timeZone}
      menuFor={menuFor}
      onMenu={setMenuFor}
      onOpen={(i) => eventPanel.open(i)}
      onEdit={(i) => eventPanel.open(i, { editing: true })}
      onReview={(i) => void reviewEvents([i], `[data-menu="${i.id}"]`)}
      onDuplicate={duplicateEvent}
      onDelete={deleteEvent}
    />
  );

  return (
    <div className={styles.wrap} ref={root}>
      <article className={styles.trip}>
        <div className={styles.hero} data-view={view}>
          <div className={styles.heading}>
            <TripHeader trip={trip} canEdit={canEdit} canManage={canManage} compact={view === "bookings"} items={items} onOpenEvent={(i) => eventPanel.open(i, { trigger: "[data-up-next]" })} onAdd={() => openAdd(all ? "" : day, "[data-add-top]")} onEdit={() => setEditingTrip(true)} onShare={() => setSharing(true)} />
          </div>
          <div className={styles.sectionNav}>
            <TripViewNav selected={view} toBook={toBook.length} overdue={overdueCount} onSelect={selectView} />
            {view === "itinerary" ? <TripHighlights data={data} /> : null}
          </div>
        </div>
        {view === "bookings" ? (
          <BookingList trip={trip} items={items} canEdit={canEdit} onOpen={(i) => eventPanel.open(i, { trigger: `[data-task-open="${i.id}"]` })} />
        ) : (
          <>
            {canEdit && drafts.length ? <DraftsNote count={drafts.length} busy={reviewing} onReviewAll={() => void reviewEvents(drafts)} /> : null}
            <DayTabs trip={trip} days={days} byDate={byDate} eventCount={items.length} pinCount={allStops.length} selected={day} onSelect={selectDay} />

            <div id="trip-panel" role="tabpanel" aria-labelledby={`tab-${day}`} className={styles.grid}>
              <div className={styles.mainColumn}>
                <div className={styles.main} ref={mainRef}>
                  {(all ? days : [day]).map((d) => {
                    const list = byDate.get(d) ?? [];
                    const timed = list.filter((i) => i.sortInstant);
                    const unscheduled = list.filter((i) => !i.sortInstant);
                    const outside = isOutside(trip, d);
                    return (
                      <DaySection
                        key={d}
                        title={fmtDay(d)}
                        meta={<>{outside ? "Outside trip dates" : `Day ${pad2(dayNumber(trip, d))} of ${pad2(inRange.length)}`}{d === trip.today ? <TodayMark /> : null}</>}
                        outside={outside}
                        empty={!list.length}
                        onAdd={canEdit ? () => openAdd(d, `[data-add-day="${d}"]`) : undefined}
                        addKey={d}
                        highlightDay={d}
                      >
                        {list.length ? (
                          <>
                            {timeline(timed, true)}
                            {unscheduled.length ? (
                              <>
                                <SubHeading>Unscheduled</SubHeading>
                                {timeline(unscheduled, true)}
                              </>
                            ) : null}
                          </>
                        ) : (
                          <p className="note">Nothing planned.</p>
                        )}
                      </DaySection>
                    );
                  })}
                  {all && undatedFlights.length ? (
                    <DaySection title="Undated flights" meta="No departure date yet" note="Flights still to be scheduled. Edit one to add a planned date or its times.">
                      {timeline(undatedFlights, false)}
                    </DaySection>
                  ) : null}
                  {all && undated.length ? (
                    <DaySection title="Undated" meta="No date yet" note="These events have no date. Edit one to place it on a day.">
                      {timeline(undated, false)}
                    </DaySection>
                  ) : null}
                  {canEdit && recentlyDeleted.length ? <RecentlyDeleted items={recentlyDeleted} onRestore={restoreEvent} /> : null}
                </div>
                <CostsSection data={data} canManage={canManage} />
                <div className={styles.location}><GlobeLocation trip={trip} canManage={canManage} /></div>
              </div>
              <MapPanel key={day} day={day} stops={stops} focus={mapFocus} onPin={goToEvent} mapsKey={mapsKey} />
            </div>
          </>
        )}
      </article>

      {canEdit ? <AddFab onClick={() => openAdd(all ? "" : day, "[data-fab]")} /> : null}

      {itemForm ? (
        <ItemForm
          tripId={trip.id}
          tripTitle={trip.title}
          tripDestination={trip.destination}
          tripZone={trip.timeZone}
          tripDates={trip}
          defaultCurrency={defaultCurrency}
          recentCurrencies={data.recentCurrencies}
          defaultDate={itemForm.date}
          item={itemForm.item}
          triggerSelector={itemForm.trigger}
          onClose={() => setItemForm(null)}
          onSaved={(saved, created) => {
            setItemForm(null);
            router.refresh();
            toast({ message: `${created ? "Event added" : "Event updated"}${saved.coordinates?.source === "map_link" ? " and pinned on the map" : saved.mapUrl && !saved.coordinates ? ". The map link has no coordinates the app can read, so it is not on the map" : ""}.` });
          }}
        />
      ) : null}
      {eventPanel.panel && eventPanel.item ? (
        <EventPanel
          trip={trip}
          item={eventPanel.item}
          open={eventPanel.panel.open}
          gone={eventPanel.gone}
          canEdit={canEdit}
          num={numbers.get(eventPanel.item.id) ?? null}
          mapsKey={mapsKey}
          defaultCurrency={defaultCurrency}
          recentCurrencies={data.recentCurrencies}
          initialEditing={eventPanel.panel.initialEditing}
          triggerSelector={eventPanel.panel.trigger}
          prev={eventPanel.previous}
          next={eventPanel.next}
          onGo={eventPanel.go}
          onClose={eventPanel.close}
          onExited={eventPanel.exited}
          onSaved={(saved) => {
            eventPanel.acceptSaved(saved);
            router.refresh();
            toast({ message: "Event updated." });
          }}
          onNotesSaved={(saved) => {
            eventPanel.acceptSaved(saved);
            router.refresh();
          }}
          onReview={canEdit ? async (i, reviewed) => (await review([i], reviewed))?.[0] ?? null : undefined}
        />
      ) : null}
      {sharing && canManage ? <ShareDialog trip={trip} canEmail={canEmail} onClose={() => setSharing(false)} /> : null}
      {editingTrip ? <TripForm trip={trip} recentCurrencies={data.recentCurrencies} onClose={() => setEditingTrip(false)} itemDates={items.map((i) => i.timelineDate).filter((d): d is string => !!d)} /> : null}
    </div>
  );
}
