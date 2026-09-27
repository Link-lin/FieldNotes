import Link from "next/link";
import type { TripSummaryDTO } from "@/shared/dto";
import { ProgressBar } from "@/components/ui/ProgressBar/ProgressBar";
import { cx } from "@/lib/cx";
import { fmtShort } from "@/lib/format";
import styles from "./Tickets.module.css";

/** "Travelling now" and "Next departure" shortcuts, when there are such trips. */
export function Tickets({ trips }: { trips: TripSummaryDTO[] }) {
  const current = trips.find((t) => t.status === "ongoing");
  const next = trips.filter((t) => t.status === "upcoming").sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (!current && !next) return null;
  return (
    <div className={styles.tickets}>
      {current ? (
        <Link className={cx(styles.ticket, styles.now)} href={`/trips/${current.id}`} data-trip-link={current.id}>
          <span className={cx("mono", styles.kind)}><i />Travelling now</span>
          <span className={styles.title}>{current.title}</span>
          <span className={styles.dest}>{current.destination}</span>
          <ProgressBar value={(current.dayIndex ?? 1) / current.dayCount} />
          <span className={cx("mono", styles.foot)}>Day {current.dayIndex} of {current.dayCount}</span>
        </Link>
      ) : null}
      {next ? (
        <Link className={styles.ticket} href={`/trips/${next.id}`} data-trip-link={next.id}>
          <span className={cx("mono", styles.kind)}><i />Next departure</span>
          <span className={styles.title}>{next.title}</span>
          <span className={styles.dest}>{next.destination} · {fmtShort(next.startDate)}</span>
          <span className={cx("mono", styles.foot)}><b>{next.daysToStart}</b> {next.daysToStart === 1 ? "day" : "days"} to go</span>
        </Link>
      ) : null}
    </div>
  );
}
