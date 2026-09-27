"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DashboardDTO, TripSummaryDTO } from "@/shared/dto";
import { dateRangeLabel, fmtShort, plural, relativeLabel, STATUS_LABEL } from "@/lib/format";
import { ClockIcon, PlusIcon, StatusIcon, WarnIcon } from "@/components/ui/Icon/icons";
import { TripForm } from "./TripForm";

const Globe = dynamic(() => import("./Globe").then((m) => m.Globe), {
  ssr: false,
  loading: () => <section className="globe-col" aria-label="Globe"><p className="globe-hint mono">Loading the globe…</p></section>,
});

export type Filter = "all" | "upcoming" | "ongoing" | "past";
export const DASH_RETURN_KEY = "fn.dashboard-return";

/** On desktop the page doesn't scroll; the left column (intro and trips) does. */
function innerScroller(): HTMLElement | null {
  for (const sel of [".dash .dash-left"]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && getComputedStyle(el).overflowY === "auto") return el;
  }
  return null;
}

/** Remembers where the dashboard was so Back or "All trips" can restore it (TRIP-1). */
function rememberReturn(tripId: string) {
  try {
    sessionStorage.setItem(DASH_RETURN_KEY, JSON.stringify({ url: window.location.pathname + window.location.search, trip: tripId, y: window.scrollY, list: innerScroller()?.scrollTop ?? 0 }));
  } catch {}
}
const ORDER = { ongoing: 0, upcoming: 1, past: 2 } as const;

export function Dashboard({ data, today, focus, initialFilter }: { data: DashboardDTO; today: string; focus: string | null; initialFilter: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selected, setSelected] = useState<string | null>(focus);
  const [focusKey, setFocusKey] = useState(focus ? 1 : 0);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => data.trips.filter((t) => filter === "all" || t.status === filter), [data.trips, filter]);
  const sorted = useMemo(
    () =>
      [...visible].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === "past" ? (a.startDate < b.startDate ? 1 : -1) : a.startDate < b.startDate ? -1 : 1)),
    [visible],
  );
  const counts = (f: Filter) => data.trips.filter((t) => f === "all" || t.status === f).length;
  const current = data.trips.find((t) => t.status === "ongoing");
  const next = data.trips.filter((t) => t.status === "upcoming").sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  const tasks = data.ownerBookingTasks;
  const overdue = tasks.filter((t) => t.state === "overdue").length;

  function select(id: string | null, fromGlobe: boolean) {
    setSelected(id);
    if (!fromGlobe && id) setFocusKey((k) => k + 1);
    if (fromGlobe && id) document.querySelector(`[data-trip="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // Coming back from a trip: restore scroll and put focus on that trip's card.
  useEffect(() => {
    let saved: { trip?: string; y?: number; list?: number } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(DASH_RETURN_KEY) ?? "null");
      sessionStorage.removeItem(DASH_RETURN_KEY);
    } catch {}
    if (!saved?.trip || focus) return;
    const link = document.querySelector<HTMLElement>(`[data-open="${CSS.escape(saved.trip)}"]`);
    if (!link) return;
    // On desktop the page itself doesn't scroll; the trip list scrolls inside its column.
    const list = innerScroller();
    if (list && typeof saved.list === "number") list.scrollTop = saved.list;
    if (typeof saved.y === "number") window.scrollTo(0, saved.y);
    link.focus({ preventScroll: typeof saved.y === "number" });
  }, [focus]);

  const onOpen = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest?.("[data-trip-link]")?.getAttribute("data-trip-link");
    if (id) rememberReturn(id);
  };

  function onFilter(f: Filter) {
    setFilter(f);
    const url = new URL(window.location.href);
    if (f === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", f);
    url.searchParams.delete("focus");
    window.history.replaceState(window.history.state, "", url);
    const sel = data.trips.find((t) => t.id === selected);
    if (sel && f !== "all" && sel.status !== f) setSelected(null);
  }

  return (
    <div className="dash" data-one-screen>
      <div className="split" onClickCapture={onOpen}>
        <div className="dash-left">
        <section className="hero">
          <p className="eyebrow mono">Your atlas · today is {fmtShort(today)}</p>
          <h1>
            Every trip, on one <em>globe.</em>
          </h1>
          <p className="lede">The places you have been and the places you are going, pinned once and easy to find again. Drag the globe, or pick a trip from the list.</p>
          {data.canCreateTrips ? (
            <div className="pills">
              <button className="pill pill-fill" type="button" onClick={() => setCreating(true)}>
                <PlusIcon /> New trip
              </button>
            </div>
          ) : null}
          {current || next ? (
            <div className="tickets">
              {current ? (
                <Link className="ticket ticket-now" href={`/trips/${current.id}`} data-trip-link={current.id}>
                  <span className="ticket-kind mono"><i />Travelling now</span>
                  <span className="ticket-title">{current.title}</span>
                  <span className="ticket-dest">{current.destination}</span>
                  <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(((current.dayIndex ?? 1) / current.dayCount) * 100)}%` }} /></span>
                  <span className="ticket-foot mono">Day {current.dayIndex} of {current.dayCount}</span>
                </Link>
              ) : null}
              {next ? (
                <Link className="ticket" href={`/trips/${next.id}`} data-trip-link={next.id}>
                  <span className="ticket-kind mono"><i />Next departure</span>
                  <span className="ticket-title">{next.title}</span>
                  <span className="ticket-dest">{next.destination} · {fmtShort(next.startDate)}</span>
                  <span className="ticket-foot mono"><b>{next.daysToStart}</b> {next.daysToStart === 1 ? "day" : "days"} to go</span>
                </Link>
              ) : null}
            </div>
          ) : null}
          <p className="stats-line mono">
            {plural(data.trips.length, "trip")} · {counts("ongoing")} now · {counts("upcoming")} ahead
            {data.canCreateTrips ? <> · {tasks.length} to book{overdue ? <b> ({overdue} overdue)</b> : null}</> : null}
          </p>
        </section>

        <section className="trips-col" aria-labelledby="list-title">
          <div className="trips-head">
            <h2 id="list-title" tabIndex={-1}>On your itinerary</h2>
            <div className="filters mono" role="group" aria-label="Filter trips by date status">
              {(["all", "upcoming", "ongoing", "past"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => onFilter(f)}>
                  {f === "all" ? "All" : STATUS_LABEL[f]} {counts(f)}
                </button>
              ))}
            </div>
          </div>
          <div className="trips-scroll">
          {data.trips.length === 0 ? (
            <div className="empty">
              <b>No trips yet</b>
              {data.canCreateTrips ? (
                <>
                  <span>Create your first trip to start planning.</span>
                  <button className="pill pill-fill" type="button" onClick={() => setCreating(true)}><PlusIcon /> New trip</button>
                </>
              ) : (
                <span>Trips shared with you will appear here after you accept an invitation.</span>
              )}
            </div>
          ) : sorted.length === 0 ? (
            <p className="note">No trips in this view. Try another filter.</p>
          ) : (
            <ul className="trip-list">
              {sorted.map((t, i) => (
                <TripCard key={t.id} trip={t} index={i} selected={t.id === selected} onFocus={() => select(t.id, false)} />
              ))}
            </ul>
          )}
          {data.canCreateTrips && tasks.length ? (
            <section className="section" id="bookings" aria-labelledby="bookings-title">
              <h3 id="bookings-title">Still to book</h3>
              <div className="card-surface tasks">
                {tasks.map((t) => (
                  <div key={t.itemId} className={`task${t.state === "overdue" ? " overdue" : ""}`}>
                    {t.state === "overdue" ? <WarnIcon /> : <ClockIcon />}
                    <span>
                      <Link href={`/trips/${t.tripId}`} data-trip-link={t.tripId}><b>{t.itemTitle}</b></Link> · {t.tripTitle}
                      <br />
                      {dueText(t.dueDate, t.state)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          </div>
        </section>
        <p className="foot">Markers are approximate destinations, never live location. The globe uses bundled map data and sends nothing to a map service.</p>
        </div>
        <Globe trips={visible} selectedId={selected} focusKey={focusKey} onSelect={select} />
      </div>
      {creating ? <TripForm trip={null} onClose={() => setCreating(false)} recentCurrencies={data.recentCurrencies} /> : null}
    </div>
  );
}

export function dueText(due: string | null, state: string): string {
  if (!due) return "No book-by date";
  if (state === "overdue") return `Overdue since ${fmtShort(due)}`;
  if (state === "due_today") return "Due today";
  return `Book by ${fmtShort(due)}`;
}

function TripCard({ trip, index, selected, onFocus }: { trip: TripSummaryDTO; index: number; selected: boolean; onFocus: () => void }) {
  return (
    <li className="trip-card" data-trip={trip.id} data-status={trip.status} data-selected={selected} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="trip-card-top">
        <span className="when mono">
          {dateRangeLabel(trip)} · <b>{relativeLabel(trip)}</b>
        </span>
        <span className="pills" style={{ gap: 6 }}>
          <span className={`tag tag-${trip.status}`}><StatusIcon status={trip.status} />{STATUS_LABEL[trip.status]}</span>
          <span className="tag tag-soft">{trip.role === "owner" ? "Owner" : "Viewer"}</span>
        </span>
      </div>
      <h3>
        <Link href={`/trips/${trip.id}`} data-trip-link={trip.id}>{trip.title}</Link>
      </h3>
      <p className="dest">
        {trip.destination}
        {trip.role === "viewer" && trip.ownerName ? <span className="muted"> · shared by {trip.ownerName}</span> : null}
      </p>
      <div className="trip-card-actions">
        <Link className="link" href={`/trips/${trip.id}`} data-open={trip.id} data-trip-link={trip.id}>Open trip</Link>
        {trip.atlasLocation ? (
          <button className="link" type="button" onClick={onFocus}>Show on globe</button>
        ) : trip.role === "owner" ? (
          <Link className="link" href={`/trips/${trip.id}#globe-location`} data-trip-link={trip.id}>Set globe location</Link>
        ) : (
          <span className="muted">Not on the globe</span>
        )}
      </div>
    </li>
  );
}
