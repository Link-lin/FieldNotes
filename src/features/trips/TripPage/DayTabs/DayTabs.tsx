import { useEffect, useRef } from "react";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { cx } from "@/lib/cx";
import { fmtDay, plural } from "@/lib/format";
import { dayTag, isOutside } from "../trip-days";
import styles from "./DayTabs.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  days: string[];
  byDate: Map<string, PlanItemDTO[]>;
  eventCount: number;
  pinCount: number;
  selected: string;
  onSelect: (day: string, focus: boolean) => void;
};

/** TRIP-2: Whole trip, then one tab per date. WAI-ARIA tabs: arrows, Home and End move between them. */
export function DayTabs({ trip, days, byDate, eventCount, pinCount, selected, onSelect }: Props) {
  // Keep the chosen tab in view in the scrolling strip, gliding there unless motion is reduced.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = strip.current;
    const tab = list?.querySelector<HTMLElement>(`[aria-selected="true"]`);
    if (!list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    const right = left + tab.offsetWidth;
    const pad = 24;
    let to: number | null = null;
    if (left - pad < list.scrollLeft) to = Math.max(0, left - pad);
    else if (right + pad > list.scrollLeft + list.clientWidth) to = right + pad - list.clientWidth;
    if (to === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: to, behavior: reduce ? "auto" : "smooth" });
  }, [selected]);
  function onKeyDown(e: React.KeyboardEvent) {
    const keys = ["all", ...days];
    const i = keys.indexOf(selected);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % keys.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + keys.length) % keys.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = keys.length - 1;
    if (n > -1) {
      e.preventDefault();
      onSelect(keys.at(n)!, true);
    }
  }
  return (
    <div className={styles.tabs} role="tablist" aria-label="Whole trip or one day" onKeyDown={onKeyDown} ref={strip}>
      <Tab id="all" selected={selected === "all"} onSelect={() => onSelect("all", false)} top="Whole trip" mid="All days" bottom={`${plural(eventCount, "event")}, ${plural(pinCount, "pin")}`} />
      {days.map((d) => {
        const list = byDate.get(d) ?? [];
        const pins = list.filter((i) => i.coordinates).length;
        return (
          <Tab
            key={d}
            id={d}
            selected={selected === d}
            outside={isOutside(trip, d)}
            onSelect={() => onSelect(d, false)}
            top={<>{dayTag(trip, d)}{d === trip.today ? <span className={styles.today}> · Today</span> : null}</>}
            mid={fmtDay(d)}
            bottom={list.length ? `${plural(list.length, "event")}, ${plural(pins, "pin")}` : "Nothing planned"}
          />
        );
      })}
    </div>
  );
}

function Tab({ id, selected, outside = false, onSelect, top, mid, bottom }: { id: string; selected: boolean; outside?: boolean; onSelect: () => void; top: React.ReactNode; mid: string; bottom: string }) {
  return (
    <button type="button" role="tab" id={`tab-${id}`} className={styles.tab} aria-selected={selected} aria-controls="trip-panel" tabIndex={selected ? 0 : -1} data-outside={outside} data-hl-day={id === "all" ? undefined : id} onClick={onSelect}>
      <span className={cx("mono", styles.top)}>{top}</span>
      <b>{mid}</b>
      <small>{bottom}</small>
    </button>
  );
}
