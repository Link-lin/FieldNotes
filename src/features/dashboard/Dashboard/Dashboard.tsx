"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { DashboardDTO } from "@/shared/dto";
import { TripForm } from "@/features/trips/TripForm/TripForm";
import { rememberReturn, innerScroller, takeReturn } from "../dashboard-return";
import { BookingTasks } from "./BookingTasks/BookingTasks";
import { GlobeLoading } from "./Globe/GlobeLoading/GlobeLoading";
import { Hero } from "./Hero/Hero";
import { TripList, type Filter } from "./TripList/TripList";
import styles from "./Dashboard.module.css";

const Globe = dynamic(() => import("./Globe/Globe").then((m) => m.Globe), {
  ssr: false,
  loading: () => <GlobeLoading className={styles.globe} />,
});

/**
 * The atlas (DASH-1, ATLAS-1): intro and trips on the left, the globe on the right. On desktop it
 * is one screen (data-one-screen); the left column scrolls and a zoomed globe fades under it.
 */
export function Dashboard({ data, focus, initialFilter }: { data: DashboardDTO; focus: string | null; initialFilter: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selected, setSelected] = useState<string | null>(focus);
  const [focusKey, setFocusKey] = useState(focus ? 1 : 0);
  const [creating, setCreating] = useState(false);
  const visible = useMemo(() => data.trips.filter((t) => filter === "all" || t.status === filter), [data.trips, filter]);

  function select(id: string | null, fromGlobe: boolean) {
    setSelected(id);
    if (!fromGlobe && id) setFocusKey((k) => k + 1);
    if (fromGlobe && id) document.querySelector(`[data-trip="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // Coming back from a trip: restore scroll and put focus on that trip's card, or the booking task opened.
  useEffect(() => {
    const saved = takeReturn();
    if (!saved?.trip || focus) return;
    const task = saved.task ? document.querySelector<HTMLElement>(`[data-task-open="${CSS.escape(saved.task)}"]`) : null;
    const link = task ?? document.querySelector<HTMLElement>(`[data-open="${CSS.escape(saved.trip)}"]`);
    if (!link) return;
    const list = innerScroller();
    if (list && typeof saved.list === "number") list.scrollTop = saved.list;
    if (typeof saved.y === "number") window.scrollTo(0, saved.y);
    link.focus({ preventScroll: typeof saved.y === "number" });
  }, [focus]);

  // Any link into a trip remembers where the dashboard was.
  const onOpen = (e: React.MouseEvent) => {
    const link = (e.target as Element).closest?.("[data-trip-link]");
    const id = link?.getAttribute("data-trip-link");
    if (id) rememberReturn(id, link?.getAttribute("data-task-open") ?? undefined);
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
    <div className={styles.dash} data-one-screen>
      <div className={styles.split} onClickCapture={onOpen}>
        <div className={styles.left} data-dash-scroll>
          <Hero className={styles.hero} data={data} onCreate={() => setCreating(true)} />
          <TripList
            className={styles.trips}
            trips={data.trips}
            filter={filter}
            onFilter={onFilter}
            selectedId={selected}
            onShowOnGlobe={(id) => select(id, false)}
            canCreate={data.canCreateTrips}
            onCreate={() => setCreating(true)}
          >
            {data.canCreateTrips && data.ownerBookingTasks.length ? <BookingTasks tasks={data.ownerBookingTasks} /> : null}
          </TripList>
          <p className={styles.foot}>Markers are approximate destinations, never live location. The globe uses bundled map data and sends nothing to a map service.</p>
        </div>
        <Globe className={styles.globe} trips={visible} selectedId={selected} focusKey={focusKey} onSelect={select} />
      </div>
      {creating ? <TripForm trip={null} onClose={() => setCreating(false)} recentCurrencies={data.recentCurrencies} /> : null}
    </div>
  );
}
