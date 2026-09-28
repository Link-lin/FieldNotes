"use client";

import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { Tag } from "@/components/ui/Tag/Tag";
import { useClientValue } from "@/lib/client-value";
import { cx } from "@/lib/cx";
import { eventTimeText, flightRoute, upNext } from "../../trip-days";
import styles from "./UpNext.module.css";

// The browser's clock to the minute, so the value stays the same between reads.
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

type Props = { trip: TripDetailDTO["trip"]; items: PlanItemDTO[]; onOpen: (item: PlanItemDTO) => void; className?: string };

/**
 * The next event, from stored data only: the trip's first event before it starts, the next one
 * today or tomorrow while it runs, nothing once it has ended. Opens like a timeline row. Below it,
 * the dated flights as one route line.
 */
export function UpNext({ trip, items, onOpen, className }: Props) {
  // Until hydration the server's day-level choice is shown, so the markup matches.
  const now = useClientValue<number | null>(thisMinute, null);
  const next = upNext(trip, items, now);
  if (!next) return null;
  const { item, label } = next;
  const route = flightRoute(items);
  return (
    <section className={cx(styles.card, className)} aria-label="Up next">
      <button type="button" className={styles.event} data-up-next aria-haspopup="dialog" onClick={() => onOpen(item)}>
        <span className={cx("mono", styles.when)}>Up next · {label}</span>
        <span className={styles.title}>
          {item.sortInstant ? <span className={styles.time}>{eventTimeText(item, trip.timeZone)}</span> : null}
          {item.title}
        </span>
        {item.location || item.bookingStatus !== "not_required" ? (
          <span className={styles.meta}>
            {item.location ? <span>{item.location}</span> : null}
            {item.bookingStatus === "needs_booking" ? <Tag tone="need">Needs booking</Tag> : item.bookingStatus === "booked" ? <Tag tone="booked">Booked</Tag> : null}
          </span>
        ) : null}
      </button>
      {route ? <p className={cx("mono", styles.route)}><span className="visually-hidden">Flights: </span>{route}</p> : null}
    </section>
  );
}
