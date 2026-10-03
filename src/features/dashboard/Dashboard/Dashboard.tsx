"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DashboardDTO } from "@/shared/dto";
import { TripForm } from "@/features/trips/TripForm/TripForm";
import { rememberReturn, innerScroller, takeReturn } from "../dashboard-return";
import { GlobeLoading } from "./Globe/GlobeLoading/GlobeLoading";
import { Hero } from "./Hero/Hero";
import { TripList, type Filter } from "./TripList/TripList";
import styles from "./Dashboard.module.css";

const Globe = dynamic(() => import("./Globe/Globe").then((m) => m.Globe), {
  ssr: false,
  loading: () => <GlobeLoading className={styles.globe} />,
});

const SPLIT_KEY = "field-notes:dashboard-left-ratio";
const MIN_LEFT = 480;
const MIN_GLOBE = 360;

function splitBounds(width: number) {
  return { min: MIN_LEFT, max: Math.min(width * 0.62, width - MIN_GLOBE) };
}

function clampLeft(value: number, width: number) {
  const { min, max } = splitBounds(width);
  return Math.max(min, Math.min(max, value));
}

function defaultLeft(width: number) {
  return clampLeft(Math.max(500, Math.min(width * 0.38, 760)), width);
}

/**
 * The atlas (DASH-1, ATLAS-1): intro and trips on the left, the globe on the right. On desktop it
 * is one screen (data-one-screen); the left column scrolls and a zoomed globe fades under it.
 */
export function Dashboard({ data, focus, initialFilter }: { data: DashboardDTO; focus: string | null; initialFilter: Filter }) {
  const splitRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selected, setSelected] = useState<string | null>(focus);
  const [focusKey, setFocusKey] = useState(focus ? 1 : 0);
  const [creating, setCreating] = useState(false);
  const [leftRatio, setLeftRatio] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [paneSize, setPaneSize] = useState({ total: 0, left: 0 });
  const visible = useMemo(() => data.trips.filter((t) => filter === "all" || t.status === filter), [data.trips, filter]);

  useEffect(() => {
    let restoreFrame = 0;
    try {
      const saved = window.localStorage.getItem(SPLIT_KEY);
      if (saved !== null) {
        const ratio = Number(saved);
        if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
          restoreFrame = window.requestAnimationFrame(() => setLeftRatio(ratio));
        }
      }
    } catch { /* A private browser can deny local storage; resizing still works. */ }

    const split = splitRef.current;
    const left = leftRef.current;
    if (!split || !left) return;
    const measure = () => {
      const total = Math.round(split.getBoundingClientRect().width);
      const leftWidth = Math.round(left.getBoundingClientRect().width);
      setPaneSize((old) => old.total === total && old.left === leftWidth ? old : { total, left: leftWidth });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(split);
    observer.observe(left);
    measure();
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      observer.disconnect();
    };
  }, []);

  function setLeft(value: number, persist: boolean) {
    const total = splitRef.current?.getBoundingClientRect().width;
    if (!total) return;
    const ratio = clampLeft(value, total) / total;
    setLeftRatio(ratio);
    if (persist) {
      try { window.localStorage.setItem(SPLIT_KEY, String(ratio)); } catch { /* Keep this session's width. */ }
    }
  }

  function fromPointer(event: React.PointerEvent<HTMLDivElement>, persist: boolean) {
    const rect = splitRef.current?.getBoundingClientRect();
    if (rect) setLeft(event.clientX - rect.left, persist);
  }

  function onDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      resetDivider();
      return;
    }
    const total = paneSize.total || splitRef.current?.getBoundingClientRect().width;
    if (!total) return;
    const current = paneSize.left || leftRef.current?.getBoundingClientRect().width || defaultLeft(total);
    const step = event.shiftKey ? 60 : 20;
    let next: number;
    if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "Home") next = splitBounds(total).min;
    else if (event.key === "End") next = splitBounds(total).max;
    else return;
    event.preventDefault();
    setLeft(next, true);
  }

  function resetDivider() {
    setLeftRatio(null);
    try { window.localStorage.removeItem(SPLIT_KEY); } catch { /* The default still applies. */ }
  }

  const minPercent = paneSize.total ? Math.round(splitBounds(paneSize.total).min / paneSize.total * 100) : 0;
  const maxPercent = paneSize.total ? Math.round(splitBounds(paneSize.total).max / paneSize.total * 100) : 100;
  const currentPercent = paneSize.total ? Math.round(paneSize.left / paneSize.total * 100) : 38;
  const splitStyle = leftRatio === null ? undefined : { "--requested-left-w": `${leftRatio * 100}%` } as CSSProperties;

  function select(id: string | null, fromGlobe: boolean) {
    setSelected(id);
    if (!fromGlobe && id) setFocusKey((k) => k + 1);
    if (fromGlobe && id) document.querySelector(`[data-trip="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // Coming back from a trip: restore scroll and focus the card's entry point.
  useEffect(() => {
    const saved = takeReturn();
    if (!saved?.trip || focus) return;
    const booking = saved.booking ? document.querySelector<HTMLElement>(`[data-booking-link="${CSS.escape(saved.trip)}"]`) : null;
    const link = booking ?? document.querySelector<HTMLElement>(`[data-open="${CSS.escape(saved.trip)}"]`);
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
    if (id) rememberReturn(id, link?.hasAttribute("data-booking-link") ?? false);
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
    <div className={styles.dash} data-one-screen data-has-trips={data.trips.length > 0 || undefined} style={splitStyle}>
      <div className={styles.split} data-resizing={resizing || undefined} ref={splitRef} onClickCapture={onOpen}>
        <div className={styles.left} id="dashboard-trip-pane" data-dash-scroll ref={leftRef}>
          <Hero className={styles.hero} data={data} onCreate={() => setCreating(true)} />
          <TripList
            className={styles.trips}
            trips={data.trips}
            bookingTasks={data.ownerBookingTasks}
            filter={filter}
            onFilter={onFilter}
            selectedId={selected}
            onShowOnGlobe={(id) => select(id, false)}
            canCreate={data.canCreateTrips}
            onCreate={() => setCreating(true)}
          />
          <p className={styles.foot}>Markers are approximate destinations, never live location. The globe uses bundled map data and sends nothing to a map service.</p>
        </div>
        <Globe className={styles.globe} trips={visible} selectedId={selected} focusKey={focusKey} onSelect={select} />
        <div
          className={styles.divider}
          role="separator"
          aria-label="Resize trip list and globe"
          aria-controls="dashboard-trip-pane"
          aria-orientation="vertical"
          aria-valuemin={minPercent}
          aria-valuemax={maxPercent}
          aria-valuenow={currentPercent}
          aria-valuetext={`Trip list ${currentPercent}% of the page`}
          tabIndex={0}
          title="Drag or use arrow keys to resize. Press Enter or double-click to reset."
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
            fromPointer(event, false);
          }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event, false); }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            fromPointer(event, true);
            event.currentTarget.releasePointerCapture(event.pointerId);
            setResizing(false);
          }}
          onPointerCancel={() => setResizing(false)}
          onKeyDown={onDividerKey}
          onDoubleClick={resetDivider}
        ><span className={styles.grip} aria-hidden="true">⋮</span></div>
      </div>
      {creating ? <TripForm trip={null} onClose={() => setCreating(false)} recentCurrencies={data.recentCurrencies} /> : null}
    </div>
  );
}
