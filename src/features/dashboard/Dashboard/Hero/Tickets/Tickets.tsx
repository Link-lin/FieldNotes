import Link from "next/link";
import type { TripSummaryDTO } from "@/shared/dto";
import { cx } from "@/lib/cx";
import styles from "./Tickets.module.css";

/** "Travelling now" and "Next departure" shortcuts, when there are such trips. */
export function Tickets({ trips }: { trips: TripSummaryDTO[] }) {
  const current = trips.find((t) => t.status === "ongoing");
  const next = trips.filter((t) => t.status === "upcoming").sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (!current && !next) return null;
  return (
    <div className={styles.tickets}>
      {current ? (
        <Link className={styles.ticket} href={`/trips/${current.id}`} data-trip-link={current.id}>
          <span className={cx("mono", styles.kind)}>Travelling now</span>
          <span className={styles.when}>Day {current.dayIndex} of {current.dayCount}</span>
          <span className={styles.title}>{current.title}</span>
        </Link>
      ) : null}
      {next ? (
        <Link className={styles.ticket} href={`/trips/${next.id}`} data-trip-link={next.id}>
          <span className={cx("mono", styles.kind)}>Next departure</span>
          <span className={styles.when}>{next.daysToStart} {next.daysToStart === 1 ? "day" : "days"} to go</span>
          <span className={styles.title}>{next.title}</span>
        </Link>
      ) : null}
    </div>
  );
}
