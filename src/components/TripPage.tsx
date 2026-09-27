"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanItemDTO, PlaceDTO, TripDetailDTO } from "@/shared/dto";
import { formatMoney } from "@/shared/money";
import { googleDayUrl, haversineKm } from "@/shared/map-links";
import { dateRange } from "@/shared/time";
import { api } from "./api";
import { DayMap, type Stop } from "./DayMap";
import { EventRow } from "./EventRow";
import { dateRangeLabel, fmtDay, fmtMonth, plural, relativeLabel, STATUS_LABEL, TYPE_LABEL } from "./format";
import { ClockIcon, EditIcon, PlusIcon, StatusIcon, WarnIcon } from "./icons";
import { ItemForm } from "./ItemForm";
import { DASH_RETURN_KEY, dueText } from "./Dashboard";
import { useToast } from "./Toast";
import { TripForm } from "./TripForm";

const TYPE_COLOR: Record<string, string> = { flight: "#3a3026", lodging: "#5e8fa0", activity: "#9a8c70", meal: "#c9b48a", transport: "#23414b", other: "#b8ab8c" };
const pad2 = (n: number) => String(n).padStart(2, "0");
const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function TripPage({ data, initialDay }: { data: TripDetailDTO; initialDay: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const { trip, items } = data;
  const owner = trip.role === "owner";
  const dayCount = trip.dayCount;

  // Tabs: every trip date plus any item date outside the range (TRIP-2).
  const byDate = useMemo(() => {
    const m = new Map<string, PlanItemDTO[]>();
    for (const i of items) if (i.timelineDate) m.set(i.timelineDate, [...(m.get(i.timelineDate) ?? []), i]);
    return m;
  }, [items]);
  const inRange = useMemo(() => dateRange(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const days = useMemo(() => [...new Set([...inRange, ...byDate.keys()])].sort(), [inRange, byDate]);
  const undated = items.filter((i) => !i.timelineDate && !i.flightDetails);
  const undatedFlights = items.filter((i) => !i.timelineDate && i.flightDetails);
  const [picked, setDay] = useState<string>(initialDay ?? "all");
  // A day can vanish after a refresh (its last out-of-range event moved); fall back to Whole trip.
  const day = picked === "all" || days.includes(picked) ? picked : "all";
  const all = day === "all";
  const scope = all ? days : [day];
  const outside = (d: string) => d < trip.startDate || d > trip.endDate;
  const dayTag = (d: string) => (outside(d) ? "Outside trip dates" : `Day ${pad2(Math.round((Date.parse(d) - Date.parse(trip.startDate)) / 86_400_000) + 1)}`);

  // Numbered stops in timeline order across the whole trip (unscheduled after timed; undated
  // unnumbered). A day tab shows the same numbers as Whole trip (TRIP-2).
  const stopsFor = useCallback(
    (dates: readonly string[]) => {
      const out: Stop[] = [];
      for (const d of dates)
        for (const i of byDate.get(d) ?? [])
          if (i.coordinates)
            out.push({
              id: i.id,
              n: out.length + 1,
              name: i.flightDetails ? `Arrive ${i.flightDetails.arrival.airportCode}` : i.location?.split(",")[0] || i.title,
              lat: i.coordinates.latitude,
              lon: i.coordinates.longitude,
              flight: !!i.flightDetails,
              need: i.bookingStatus === "needs_booking",
              day: d,
              dayLabel: `${dayTag(d)} · ${fmtDay(d)}`,
            });
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDate, trip.startDate, trip.endDate],
  );
  const allStops = useMemo(() => stopsFor(days), [stopsFor, days]);
  const stops = all ? allStops : allStops.filter((s) => s.day === day);
  const num = new Map(allStops.map((s) => [s.id, { n: s.n, need: s.need }]));
  let distance = 0;
  allStops.forEach((s, i) => {
    const p = allStops[i - 1];
    if (p && p.day === s.day && !p.flight && !s.flight) distance += haversineKm([p.lat, p.lon], [s.lat, s.lon]);
  });

  const toBook = items.filter((i) => i.bookingStatus === "needs_booking");
  const overdue = toBook.some((i) => i.bookingDueState === "overdue");

  // Dialog state.
  const [editingTrip, setEditingTrip] = useState(false);
  const [itemForm, setItemForm] = useState<{ item: PlanItemDTO | null; date: string; trigger: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Deleted this visit and still restorable, so Undo stays reachable after the toast closes.
  const [recentlyDeleted, setRecentlyDeleted] = useState<PlanItemDTO[]>([]);

  const dashboardUrl = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DASH_RETURN_KEY) ?? "null") as { url?: string } | null;
      if (saved?.url && saved.url.startsWith("/") && !saved.url.startsWith("//")) return saved.url;
    } catch {}
    return "/";
  };

  function selectDay(d: string, focus = true) {
    setDay(d);
    const url = new URL(window.location.href);
    if (d === "all") url.searchParams.delete("day");
    else url.searchParams.set("day", d);
    window.history.replaceState(window.history.state, "", url);
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${d}`)?.focus());
  }

  function onTabKey(e: React.KeyboardEvent) {
    const keys = ["all", ...days];
    const i = keys.indexOf(day);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % keys.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + keys.length) % keys.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = keys.length - 1;
    if (n > -1) {
      e.preventDefault();
      selectDay(keys[n]!);
    }
  }

  // Escape returns to the dashboard when nothing else wants it (TRIP-1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isField(e.target)) return;
      if (document.querySelector(".modal") || document.querySelector(".menu:not([hidden])") || document.querySelector(".toast")) return;
      router.push(dashboardUrl());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  // Linked highlight between timeline rows, stop list and pins.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const set = (id: string, on: boolean) => el.querySelectorAll(`[data-hl="${CSS.escape(id)}"]`).forEach((x) => x.classList.toggle("hl", on));
    const over = (e: Event) => {
      const t = (e.target as Element).closest?.("[data-hl]");
      if (t) set(t.getAttribute("data-hl")!, e.type === "mouseover" || e.type === "focusin");
    };
    ["mouseover", "mouseout", "focusin", "focusout"].forEach((t) => el.addEventListener(t, over));
    return () => ["mouseover", "mouseout", "focusin", "focusout"].forEach((t) => el.removeEventListener(t, over));
  }, []);

  function goToEvent(id: string) {
    const row = root.current?.querySelector<HTMLElement>(`.timeline [data-hl="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.classList.add("hl");
    setTimeout(() => row.classList.remove("hl"), 1600);
  }

  function nextFocusAfter(id: string): string {
    const row = root.current?.querySelector(`.timeline [data-hl="${CSS.escape(id)}"]`);
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
    toast({
      message: "Event deleted.",
      actionLabel: "Undo",
      afterFocus: after,
      onAction: () => restoreEvent(item),
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
  const rows = (list: PlanItemDTO[], numbered: boolean) => (
    <ul className="timeline">
      {list.map((i) => (
        <EventRow
          key={i.id}
          item={i}
          num={numbered ? num.get(i.id) ?? null : null}
          owner={owner}
          tripZone={trip.timeZone}
          menuOpen={menuFor === i.id}
          onMenu={(o) => setMenuFor(o ? i.id : null)}
          onEdit={() => {
            setMenuFor(null);
            setItemForm({ item: i, date: "", trigger: `[data-menu="${i.id}"]` });
          }}
          onDuplicate={() => duplicateEvent(i)}
          onDelete={() => deleteEvent(i)}
        />
      ))}
    </ul>
  );

  const statusTile =
    trip.status === "upcoming" ? (
      <><b>{trip.daysToStart}<small>{trip.daysToStart === 1 ? "day" : "days"}</small></b><span className="mono">Until departure</span></>
    ) : trip.status === "ongoing" ? (
      <><b>Day {trip.dayIndex}<small>of {dayCount}</small></b><span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(((trip.dayIndex ?? 1) / dayCount) * 100)}%` }} /></span><span className="mono">Travelling now</span></>
    ) : (
      <><b style={{ fontSize: 20, padding: "4px 0" }}>{relativeLabel(trip)}</b><span className="mono">Trip ended</span></>
    );
  const cmp = data.budgetComparison;
  const totals = data.plannedTotals;

  return (
    <div className="trip-wrap" ref={root}>
      <article className="trip">
        <Link
          className="back mono"
          href="/"
          onClick={(e) => {
            const url = dashboardUrl();
            if (url !== "/") {
              e.preventDefault();
              router.push(url);
            }
          }}
        >
          ← All trips
        </Link>
        <header className="trip-head">
          <div className="trip-meta">
            <span className="mono">{dateRangeLabel(trip)} · {trip.timeZone}</span>
            <span className={`tag tag-${trip.status}`}><StatusIcon status={trip.status} />{STATUS_LABEL[trip.status]}</span>
            <span className="tag tag-soft">{owner ? "Owner" : `Viewer${trip.ownerName ? `, shared by ${trip.ownerName}` : ""}`}</span>
          </div>
          <Stamp city={trip.destination.split(",")[0] ?? trip.destination} start={trip.startDate} days={dayCount} status={trip.status} />
          <h1 id="trip-title" tabIndex={-1}>{trip.title}</h1>
          <p className="trip-dest">{trip.destination}</p>
          <div className="trip-actions">
            {owner ? (
              <>
                <button className="pill pill-fill" type="button" data-add-top onClick={() => openAdd(all ? "" : day, "[data-add-top]")}><PlusIcon /> Add to itinerary</button>
                <button className="pill" type="button" data-edit-trip onClick={() => setEditingTrip(true)}><EditIcon /> Edit trip</button>
              </>
            ) : null}
            {trip.atlasLocation ? <Link className={`pill${owner ? " pill-quiet" : ""}`} href={`/?focus=${trip.id}`}>Show on globe</Link> : null}
          </div>
        </header>

        <div className="tiles">
          <div className="tile">{statusTile}</div>
          <div className="tile"><b>{dayCount}<small>{dayCount === 1 ? "day" : "days"}</small></b><span className="mono">Length</span></div>
          <div className="tile"><b>{items.length}</b><span className="mono">Events</span></div>
          <div className="tile"><b>{allStops.length}</b><span className="mono">Pinned</span></div>
          {distance > 0 ? <div className="tile"><b>{Math.round(distance)}<small>km</small></b><span className="mono">Between stops</span></div> : null}
          {cmp ? (
            <div className={`tile tile-budget${cmp.over ? " warn" : ""}`}>
              <b>{formatMoney(cmp.planned, cmp.currency)}<small>of {formatMoney(cmp.budget, cmp.currency)}</small></b>
              <span className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Number(cmp.budget) > 0 ? (Number(cmp.planned) / Number(cmp.budget)) * 100 : 100)}%` }} /></span>
              <span className="mono">Planned vs budget</span>
            </div>
          ) : totals.length === 1 ? (
            <div className="tile"><b>{formatMoney(totals[0]!.total, totals[0]!.currency)}</b><span className="mono">Planned</span></div>
          ) : totals.length > 1 ? (
            <div className="tile"><b style={{ fontSize: 20, padding: "4px 0" }}>{totals.length} currencies</b><span className="mono">Planned costs</span></div>
          ) : null}
          <div className={`tile${overdue ? " warn" : ""}`}><b>{toBook.length}</b><span className="mono">To book</span></div>
        </div>

        <div className="tabs" role="tablist" aria-label="Whole trip or one day" onKeyDown={onTabKey}>
          <Tab id="all" selected={all} onSelect={() => selectDay("all", false)} top="Whole trip" mid="All days" bottom={`${plural(items.length, "event")}, ${plural(allStops.length, "pin")}`} />
          {days.map((d) => {
            const list = byDate.get(d) ?? [];
            const pins = list.filter((i) => i.coordinates).length;
            return (
              <Tab
                key={d}
                id={d}
                selected={day === d}
                outside={outside(d)}
                onSelect={() => selectDay(d, false)}
                top={<>{dayTag(d)}{d === trip.today ? <span className="today"> · Today</span> : null}</>}
                mid={fmtDay(d)}
                bottom={list.length ? `${plural(list.length, "event")}, ${plural(pins, "pin")}` : "Nothing planned"}
              />
            );
          })}
        </div>

        <div id="trip-panel" role="tabpanel" aria-labelledby={`tab-${day}`} className="trip-grid">
          <div className="trip-main">
            {scope.map((d) => {
              const list = byDate.get(d) ?? [];
              return (
                <section className="day" key={d} data-empty={!list.length} data-outside={outside(d)} aria-label={fmtDay(d)}>
                  <div className="day-head">
                    <h2>{fmtDay(d)}</h2>
                    <span className="mono">
                      {outside(d) ? "Outside trip dates" : `Day ${pad2(Math.round((Date.parse(d) - Date.parse(trip.startDate)) / 86_400_000) + 1)} of ${pad2(inRange.length)}`}
                      {d === trip.today ? <span className="today"> · Today</span> : null}
                    </span>
                  </div>
                  {list.length ? (
                    <>
                      {rows(list.filter((i) => i.sortInstant), true)}
                      {list.some((i) => !i.sortInstant) ? (
                        <>
                          <h3 className="sub-head mono">Unscheduled</h3>
                          {rows(list.filter((i) => !i.sortInstant), true)}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="note">Nothing planned.</p>
                  )}
                  {owner ? (
                    <button className="add-row" type="button" data-add-day={d} onClick={() => openAdd(d, `[data-add-day="${d}"]`)}>
                      <PlusIcon /> Add an event to this day
                    </button>
                  ) : null}
                </section>
              );
            })}
            {all && undatedFlights.length ? (
              <section className="day" aria-label="Undated flights">
                <div className="day-head">
                  <h2>Undated flights</h2>
                  <span className="mono">No departure date yet</span>
                </div>
                <p className="note">Flights still to be scheduled. Edit one to add a planned date or its times.</p>
                {rows(undatedFlights, false)}
              </section>
            ) : null}
            {all && undated.length ? (
              <section className="day" aria-label="Undated">
                <div className="day-head">
                  <h2>Undated</h2>
                  <span className="mono">No date yet</span>
                </div>
                <p className="note">These events have no date. Edit one to place it on a day.</p>
                {rows(undated, false)}
              </section>
            ) : null}
            {owner && recentlyDeleted.length ? (
              <section className="day recently-deleted" aria-labelledby="deleted-title">
                <div className="day-head">
                  <h2 id="deleted-title">Recently deleted</h2>
                  <span className="mono">Restorable for 10 minutes</span>
                </div>
                <ul className="deleted-list">
                  {recentlyDeleted.map((i) => (
                    <li key={i.id}>
                      <span>{i.title}</span>
                      <button className="link" type="button" onClick={() => restoreEvent(i)} aria-label={`Restore ${i.title}`}>Restore</button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <aside className="map-aside" aria-label="Map">
            <div className="map-card">
              <div className="map-cap mono">
                <span>Sketch map, no streets</span>
                <b>{all ? "Whole trip" : fmtDay(day)}</b>
              </div>
              {!all && stops.length ? (
                <>
                  <a className="pill" href={googleDayUrl(stops.map((s) => [s.lat, s.lon] as const)) ?? "#"} target="_blank" rel="noopener noreferrer">
                    {stops.length > 1 ? "Open this day in Google Maps" : "Open in Google Maps"} ↗
                  </a>
                  <p className="map-help">Opens Google Maps with this day&apos;s pinned locations.{stops.length > 10 ? " Only the first 10 stops are included." : ""}</p>
                </>
              ) : null}
              <DayMap key={day} stops={stops} showDays={all} onPin={goToEvent} />
              {stops.length ? (
                <p className="note">Zoom with + and −, the wheel or a pinch, and drag to move. Pins come from saved map links; streets are not drawn.{all ? " Choose a day to open its route in Google Maps." : ""}</p>
              ) : null}
            </div>
          </aside>
        </div>

        <section className="section" aria-labelledby="costs-title">
          <h3 id="costs-title">Planned costs</h3>
          {!totals.length && !trip.budget ? (
            <div className="card-surface"><p className="note">No prices yet.{owner ? " Add a price to an event, or set a trip budget with Edit trip." : ""}</p></div>
          ) : (
            <>
              <div className="costs">
                {[...(trip.budget && !totals.some((t) => t.currency === trip.budget!.currency) ? [{ currency: trip.budget.currency, total: "0", priceCount: 0, unverifiedCount: 0, byType: [] }] : []), ...totals].map((t) => (
                  <div className="card-surface cost" key={t.currency}>
                    <div className="cost-head mono"><span>{t.currency}</span><span>{plural(t.priceCount, "price")}</span></div>
                    <b className="cost-total">{formatMoney(t.total, t.currency)}</b>
                    {cmp && cmp.currency === t.currency ? (
                      <>
                        <div className="budget-bar" data-over={cmp.over} aria-hidden="true">
                          <i style={{ width: `${Math.min(100, Number(cmp.budget) > 0 ? (Number(cmp.planned) / Number(cmp.budget)) * 100 : 100)}%` }} />
                        </div>
                        <span className="budget-text" data-over={cmp.over}>
                          {cmp.over
                            ? `Over budget by ${formatMoney(cmp.remaining, cmp.currency)} (budget ${formatMoney(cmp.budget, cmp.currency)})`
                            : `${formatMoney(cmp.remaining, cmp.currency)} left of your ${formatMoney(cmp.budget, cmp.currency)} budget`}
                        </span>
                      </>
                    ) : null}
                    {t.byType.length ? (
                      <>
                        <div className="stack" aria-hidden="true">
                          {t.byType.map((b) => (
                            <i key={b.type} style={{ flex: `${Math.max(Number(b.amount), 0.0001)} 1 0`, background: TYPE_COLOR[b.type] }} />
                          ))}
                        </div>
                        <ul className="breakdown">
                          {t.byType.map((b) => (
                            <li key={b.type}><i style={{ background: TYPE_COLOR[b.type] }} aria-hidden="true" /><span>{TYPE_LABEL[b.type]}</span><b>{formatMoney(b.amount, t.currency)}</b></li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {t.unverifiedCount ? <p className="note">Includes {plural(t.unverifiedCount, "unverified AI estimate")}.</p> : null}
                  </div>
                ))}
              </div>
              {totals.length + (trip.budget && !totals.some((t) => t.currency === trip.budget!.currency) ? 1 : 0) > 1 ? (
                <p className="note">Different currencies are never added together or converted.{trip.budget ? ` Only ${trip.budget.currency} costs count toward the budget.` : ""}</p>
              ) : null}
            </>
          )}
        </section>

        <div className="details">
          <section className="section" aria-labelledby="book-title">
            <h3 id="book-title">Still to book</h3>
            <div className="card-surface tasks">
              {!owner ? <p className="note">Read only. {trip.ownerName ?? "The owner"} manages the bookings.</p> : null}
              {!toBook.length ? <p className="note">Nothing waiting to be booked.</p> : null}
              {[...toBook]
                .sort((a, b) => ((a.bookingDueDate ?? "9999") < (b.bookingDueDate ?? "9999") ? -1 : 1))
                .map((i) => (
                  <div key={i.id} className={`task${i.bookingDueState === "overdue" ? " overdue" : ""}`}>
                    {i.bookingDueState === "overdue" ? <WarnIcon /> : <ClockIcon />}
                    <span><b>{i.title}</b><br />{dueText(i.bookingDueDate, i.bookingDueState ?? "no_due_date")}</span>
                  </div>
                ))}
            </div>
          </section>
          <GlobeLocation trip={trip} owner={owner} />
        </div>
      </article>

      {owner ? (
        <button className="fab" type="button" data-fab onClick={() => openAdd(all ? "" : day, "[data-fab]")}>
          <PlusIcon /> Add to itinerary
        </button>
      ) : null}

      {itemForm ? (
        <ItemForm
          tripId={trip.id}
          tripTitle={trip.title}
          tripZone={trip.timeZone}
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
      {editingTrip ? <TripForm trip={trip} recentCurrencies={data.recentCurrencies} onClose={() => setEditingTrip(false)} itemDates={items.map((i) => i.timelineDate).filter((d): d is string => !!d)} /> : null}
    </div>
  );
}

function Tab({ id, selected, outside = false, onSelect, top, mid, bottom }: { id: string; selected: boolean; outside?: boolean; onSelect: () => void; top: React.ReactNode; mid: string; bottom: string }) {
  return (
    <button type="button" role="tab" id={`tab-${id}`} aria-selected={selected} aria-controls="trip-panel" tabIndex={selected ? 0 : -1} data-outside={outside} onClick={onSelect}>
      <span className="mono">{top}</span>
      <b>{mid}</b>
      <small>{bottom}</small>
    </button>
  );
}

function Stamp({ city, start, days, status }: { city: string; start: string; days: number; status: string }) {
  return (
    <svg className="stamp" data-status={status} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <path id="stamp-arc" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
      </defs>
      <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="60" cy="60" r="35" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
      <text fontFamily="var(--mono)" fontSize="9.5" fontWeight="500" fill="currentColor">
        <textPath href="#stamp-arc" textLength="276" lengthAdjust="spacing">{`${city.toUpperCase().slice(0, 18)} · FIELD NOTES ·`}</textPath>
      </text>
      <text x="60" y="58" textAnchor="middle" fontFamily="var(--serif)" fontSize="20" fontWeight="700" fill="currentColor">{fmtMonth(start)}</text>
      <text x="60" y="73" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="currentColor">{start.slice(0, 4)} · {days}D</text>
    </svg>
  );
}

/** ATLAS-4: owner search over the bundled catalog, save or clear the trip's globe point. */
function GlobeLocation({ trip, owner }: { trip: TripDetailDTO["trip"]; owner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceDTO[]>([]);
  const [pick, setPick] = useState<PlaceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await api<{ places: PlaceDTO[] }>("GET", `/api/atlas/places?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setResults(r.data.places);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function save(point: { latitude: number; longitude: number } | null) {
    setError(null);
    const r = await api("PATCH", `/api/trips/${trip.id}`, {
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      timeZone: trip.timeZone,
      budget: trip.budget,
      expectedVersion: trip.version,
      atlasLocation: point,
    });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setPick(null);
    setQ("");
    toast({ message: point ? "Globe point saved." : "Globe point cleared." });
    router.refresh();
  }

  const p = trip.atlasLocation;
  return (
    <section className="section" id="globe-location" aria-labelledby="globe-title">
      <h3 id="globe-title">Globe location</h3>
      <div className="card-surface" style={{ display: "grid", gap: 10 }}>
        {p ? (
          <>
            <p className="coords">
              {Math.abs(p.latitude).toFixed(2)}° {p.latitude >= 0 ? "N" : "S"}, {Math.abs(p.longitude).toFixed(2)}° {p.longitude >= 0 ? "E" : "W"}
            </p>
            <p className="note">{p.source === "owner" ? (owner ? "Point set by you." : "Point set by the trip owner.") : "Approximate destination, matched from the bundled place list."}</p>
          </>
        ) : (
          <p className="note">This trip has no point yet, so it appears in the list only.{owner ? " Pick a place to show it on the globe." : ""}</p>
        )}
        {owner ? (
          <>
            <label className="field" htmlFor="place-q">
              Search places (bundled list, nothing is sent out)
              <input id="place-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try Ushuaia or Santiago" autoComplete="off" />
            </label>
            {q.trim().length >= 2 && results.length ? (
              <div className="place-results" role="group" aria-label="Matching places">
                {results.map((r) => (
                  <button key={r.id} type="button" aria-pressed={pick?.id === r.id} onClick={() => setPick(r)}>{r.label}</button>
                ))}
              </div>
            ) : q.trim().length >= 2 ? (
              <p className="note">No match. Try a nearby city.</p>
            ) : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="pills">
              <button className="pill pill-fill" type="button" disabled={!pick} onClick={() => pick && save({ latitude: pick.latitude, longitude: pick.longitude })}>Save point</button>
              {p ? <button className="pill" type="button" onClick={() => save(null)}>Clear point</button> : null}
            </div>
          </>
        ) : (
          <p className="note">Only the owner can change this point.</p>
        )}
      </div>
    </section>
  );
}
