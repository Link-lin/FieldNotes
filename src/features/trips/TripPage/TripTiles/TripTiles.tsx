"use client";

import { useEffect, useRef, useState } from "react";
import type { TripDetailDTO } from "@/shared/dto";
import { formatMoney } from "@/shared/money";
import { ProgressBar } from "@/components/ui/ProgressBar/ProgressBar";
import { cx } from "@/lib/cx";
import { relativeLabel } from "@/lib/format";
import styles from "./TripTiles.module.css";

type Props = { data: TripDetailDTO; pinned: number; distanceKm: number; toBook: number; overdue: boolean };

function Tile({ label, warn, budget, children }: { label: string; warn?: boolean; budget?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx(styles.tile, warn && styles.warn, budget && styles.budget)}>
      {children}
      <span className="mono">{label}</span>
    </div>
  );
}

/**
 * At-a-glance numbers: status, length, events, pins, distance, money and what's left to book. On
 * phones they form one strip that scrolls sideways (I8); only while it overflows can it take focus,
 * so a keyboard can scroll it too.
 */
export function TripTiles({ data, pinned, distanceKm, toBook, overdue }: Props) {
  const { trip, items, budgetComparison: cmp, plannedTotals: totals } = data;
  const days = trip.dayCount;
  const strip = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Also re-checked when the data changes, since a new tile can make the strip overflow.
    const observer = new ResizeObserver(() => setScrolls(el.scrollWidth > el.clientWidth + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [data]);
  return (
    <div className={styles.tiles} ref={strip} role="group" aria-label="Trip summary" tabIndex={scrolls ? 0 : undefined}>
      {trip.status === "upcoming" ? (
        <Tile label="Until departure"><b>{trip.daysToStart}<small>{trip.daysToStart === 1 ? "day" : "days"}</small></b></Tile>
      ) : trip.status === "ongoing" ? (
        <Tile label="Travelling now">
          <b>Day {trip.dayIndex}<small>of {days}</small></b>
          <ProgressBar value={(trip.dayIndex ?? 1) / days} />
        </Tile>
      ) : (
        <Tile label="Trip ended"><b className={styles.words}>{relativeLabel(trip)}</b></Tile>
      )}
      <Tile label="Length"><b>{days}<small>{days === 1 ? "day" : "days"}</small></b></Tile>
      <Tile label="Events"><b>{items.length}</b></Tile>
      <Tile label="Pinned"><b>{pinned}</b></Tile>
      {distanceKm > 0 ? <Tile label="Between stops"><b>{Math.round(distanceKm)}<small>km</small></b></Tile> : null}
      {cmp ? (
        <Tile label="Planned vs budget" warn={cmp.over} budget>
          <b>{formatMoney(cmp.planned, cmp.currency)}<small>of {formatMoney(cmp.budget, cmp.currency)}</small></b>
          <ProgressBar value={Number(cmp.budget) > 0 ? Number(cmp.planned) / Number(cmp.budget) : 1} />
        </Tile>
      ) : totals.length === 1 ? (
        <Tile label="Planned"><b>{formatMoney(totals[0]!.total, totals[0]!.currency)}</b></Tile>
      ) : totals.length > 1 ? (
        <Tile label="Planned costs"><b className={styles.words}>{totals.length} currencies</b></Tile>
      ) : null}
      <Tile label="To book" warn={overdue}><b>{toBook}</b></Tile>
    </div>
  );
}
