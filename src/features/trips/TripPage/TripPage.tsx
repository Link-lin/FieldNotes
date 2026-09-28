"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { useToast } from "@/components/ui/Toast/Toast";
import { dashboardUrl } from "@/features/dashboard/dashboard-return";
import { ItemForm } from "@/features/trips/ItemForm/ItemForm";
import { TripForm } from "@/features/trips/TripForm/TripForm";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/format";
import { AddFab } from "./AddFab/AddFab";
import { BookingList } from "./BookingList/BookingList";
import { CostsSection } from "./CostsSection/CostsSection";
import { DaySection, SubHeading, TodayMark } from "./DaySection/DaySection";
import { EventPanel } from "./EventPanel/EventPanel";
import { DayTabs } from "./DayTabs/DayTabs";
import { GlobeLocation } from "./GlobeLocation/GlobeLocation";
import { MapPanel } from "./MapPanel/MapPanel";
import { RecentlyDeleted } from "./RecentlyDeleted/RecentlyDeleted";
import { ShareDialog } from "./ShareDialog/ShareDialog";
import { Timeline } from "./Timeline/Timeline";
import { TripHeader } from "./TripHeader/TripHeader";
import { TripTiles } from "./TripTiles/TripTiles";
import { dayNumber, isOutside, pad2, straightLineKm, tripDays, tripStops } from "./trip-days";
import styles from "./TripPage.module.css";

const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
const LIT = "data-lit";

type ItemFormState = { item: PlanItemDTO | null; date: string; trigger: string | null };

/**
 * A trip on its own page (TRIP-1 to TRIP-9): header, tiles, day tabs, the timeline with its map,
 * costs, bookings and globe location. This component holds the page state and actions; each part
 * renders itself.
 */
export function TripPage({ data, initialDay, mapsKey }: { data: TripDetailDTO; initialDay: string | null; mapsKey: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const { trip, items } = data;
  const owner = trip.role === "owner";

  const { byDate, inRange, days } = useMemo(() => tripDays(trip, items), [trip, items]);
  const undated = items.filter((i) => !i.timelineDate && !i.flightDetails);
  const undatedFlights = items.filter((i) => !i.timelineDate && i.flightDetails);
  const [picked, setDay] = useState<string>(initialDay ?? "all");
  // A day can vanish after a refresh (its last out-of-range event moved); fall back to Whole trip.
  const day = picked === "all" || days.includes(picked) ? picked : "all";
  const all = day === "all";

  // Stop numbers run across the whole trip; a day tab shows the same numbers (TRIP-2).
  const allStops = useMemo(() => tripStops(trip, byDate, days), [trip, byDate, days]);
  const stops = all ? allStops : allStops.filter((s) => s.day === day);
  const numbers = new Map(allStops.map((s) => [s.id, { n: s.n, need: s.need }]));
  const toBook = items.filter((i) => i.bookingStatus === "needs_booking");

  const [editingTrip, setEditingTrip] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The event side panel (TRIP-10). `open` turns false while it slides out; `snapshot` keeps an
  // event that disappeared (deleted elsewhere) on screen until then.
  const [panel, setPanel] = useState<{ id: string; open: boolean; snapshot: PlanItemDTO; initialEditing: boolean; trigger: string } | null>(null);
  // Deleted this visit and still restorable, so Undo stays reachable after the toast closes.
  const [recentlyDeleted, setRecentlyDeleted] = useState<PlanItemDTO[]>([]);

  function selectDay(d: string, focus: boolean) {
    setDay(d);
    const url = new URL(window.location.href);
    if (d === "all") url.searchParams.delete("day");
    else url.searchParams.set("day", d);
    window.history.replaceState(window.history.state, "", url);
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${d}`)?.focus());
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

  // Linked highlight: hovering or focusing a row, a stop line or a pin lights all three (MAP-5).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const set = (id: string, on: boolean) => el.querySelectorAll(`[data-hl="${CSS.escape(id)}"]`).forEach((x) => x.toggleAttribute(LIT, on));
    const over = (e: Event) => {
      const t = (e.target as Element).closest?.("[data-hl]");
      if (t) set(t.getAttribute("data-hl")!, e.type === "mouseover" || e.type === "focusin");
    };
    const kinds = ["mouseover", "mouseout", "focusin", "focusout"];
    kinds.forEach((t) => el.addEventListener(t, over));
    return () => kinds.forEach((t) => el.removeEventListener(t, over));
  }, []);

  const rowOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-timeline] [data-hl="${CSS.escape(id)}"]`) ?? null;

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
  const shown = [
    ...(all ? days : [day]).flatMap((d) => {
      const list = byDate.get(d) ?? [];
      return [...list.filter((i) => i.sortInstant), ...list.filter((i) => !i.sortInstant)];
    }),
    ...(all ? [...undatedFlights, ...undated] : []),
  ];
  const currentPanelItem = panel ? items.find((i) => i.id === panel.id) : null;
  const panelItem = panel ? (currentPanelItem && currentPanelItem.version >= panel.snapshot.version ? currentPanelItem : panel.snapshot) : null;
  const panelAt = panelItem ? shown.findIndex((i) => i.id === panelItem.id) : -1;
  const openPanel = (item: PlanItemDTO, editing = false) => {
    setMenuFor(null);
    if (window.matchMedia("(max-width: 600px)").matches) {
      const query = new URLSearchParams();
      if (!all) query.set("day", day);
      if (editing) query.set("edit", "1");
      router.push(`/trips/${trip.id}/items/${item.id}${query.size ? `?${query}` : ""}`);
      return;
    }
    setPanel({ id: item.id, open: true, snapshot: item, initialEditing: editing, trigger: editing ? `[data-menu="${item.id}"]` : `[data-details="${item.id}"]` });
  };
  const closePanel = () => setPanel((p) => (p ? { ...p, open: false } : p));
  const panelExited = () => setPanel((p) => (p && !p.open ? null : p));

  const timeline = (list: PlanItemDTO[], numbered: boolean) => (
    <Timeline
      items={list}
      numbers={numbered ? numbers : null}
      owner={owner}
      tripZone={trip.timeZone}
      menuFor={menuFor}
      onMenu={setMenuFor}
      onOpen={(i) => openPanel(i)}
      onEdit={(i) => {
        setMenuFor(null);
        openPanel(i, true);
      }}
      onDuplicate={duplicateEvent}
      onDelete={deleteEvent}
    />
  );

  return (
    <div className={styles.wrap} ref={root}>
      <article className={styles.trip}>
        <TripHeader trip={trip} owner={owner} onAdd={() => openAdd(all ? "" : day, "[data-add-top]")} onEdit={() => setEditingTrip(true)} onShare={() => setSharing(true)} />
        <TripTiles data={data} pinned={allStops.length} distanceKm={straightLineKm(allStops)} toBook={toBook.length} overdue={toBook.some((i) => i.bookingDueState === "overdue")} />
        <DayTabs trip={trip} days={days} byDate={byDate} eventCount={items.length} pinCount={allStops.length} selected={day} onSelect={selectDay} />

        <div id="trip-panel" role="tabpanel" aria-labelledby={`tab-${day}`} className={styles.grid}>
          <div className={styles.main}>
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
                  onAdd={owner ? () => openAdd(d, `[data-add-day="${d}"]`) : undefined}
                  addKey={d}
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
            {owner && recentlyDeleted.length ? <RecentlyDeleted items={recentlyDeleted} onRestore={restoreEvent} /> : null}
          </div>
          <MapPanel key={day} day={day} stops={stops} onPin={goToEvent} mapsKey={mapsKey} />
        </div>

        <CostsSection data={data} owner={owner} />
        <div className={styles.details}>
          <BookingList items={items} owner={owner} ownerName={trip.ownerName} />
          <GlobeLocation trip={trip} owner={owner} />
        </div>
      </article>

      {owner ? <AddFab onClick={() => openAdd(all ? "" : day, "[data-fab]")} /> : null}

      {itemForm ? (
        <ItemForm
          tripId={trip.id}
          tripTitle={trip.title}
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
      {panel && panelItem ? (
        <EventPanel
          trip={trip}
          item={panelItem}
          open={panel.open}
          owner={owner}
          num={numbers.get(panelItem.id) ?? null}
          mapsKey={mapsKey}
          defaultCurrency={defaultCurrency}
          recentCurrencies={data.recentCurrencies}
          initialEditing={panel.initialEditing}
          triggerSelector={panel.trigger}
          prev={panelAt > 0 ? (shown[panelAt - 1] ?? null) : null}
          next={panelAt >= 0 ? (shown[panelAt + 1] ?? null) : null}
          onGo={(i) => setPanel({ id: i.id, open: true, snapshot: i, initialEditing: false, trigger: `[data-details="${i.id}"]` })}
          onClose={closePanel}
          onExited={panelExited}
          onSaved={(saved) => {
            setPanel((p) => p && p.id === saved.id ? { ...p, snapshot: saved } : p);
            router.refresh();
            toast({ message: "Event updated." });
          }}
          onNotesSaved={(saved) => {
            setPanel((p) => p && p.id === saved.id ? { ...p, snapshot: saved } : p);
            router.refresh();
          }}
        />
      ) : null}
      {sharing && owner ? <ShareDialog trip={trip} onClose={() => setSharing(false)} /> : null}
      {editingTrip ? <TripForm trip={trip} recentCurrencies={data.recentCurrencies} onClose={() => setEditingTrip(false)} itemDates={items.map((i) => i.timelineDate).filter((d): d is string => !!d)} /> : null}
    </div>
  );
}
