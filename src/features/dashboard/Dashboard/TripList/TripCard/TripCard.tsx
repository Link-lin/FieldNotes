import Link from "next/link";
import type { TripSummaryDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { StatusIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { cx } from "@/lib/cx";
import { dateRangeLabel, relativeLabel, STATUS_LABEL } from "@/lib/format";
import { canManage, ROLE_LABEL } from "@/shared/roles";
import styles from "./TripCard.module.css";

/** One trip in the list, with a compact route to its booking work when needed. */
export function TripCard({ trip, booking, index, selected, onShowOnGlobe }: { trip: TripSummaryDTO; booking?: { total: number; overdue: number }; index: number; selected: boolean; onShowOnGlobe: () => void }) {
  return (
    <li className={styles.card} data-trip={trip.id} data-status={trip.status} data-selected={selected} style={{ animationDelay: `${index * 70}ms` }}>
      <div className={styles.top}>
        <span className={cx("mono", styles.when)}>
          {dateRangeLabel(trip)} · <b>{relativeLabel(trip)}</b>
        </span>
        <span className={styles.tags}>
          <Tag tone={trip.status}><StatusIcon status={trip.status} />{STATUS_LABEL[trip.status]}</Tag>
          <Tag tone="soft">{ROLE_LABEL[trip.role]}</Tag>
        </span>
      </div>
      <h3 className={styles.title}>
        <Link href={`/trips/${trip.id}`} data-trip-link={trip.id}>{trip.title}</Link>
      </h3>
      <p className={styles.dest}>
        {trip.destination}
        {!trip.primaryOwner && trip.ownerName ? <span className="muted"> · shared by {trip.ownerName}</span> : null}
      </p>
      <div className={styles.actions}>
        <ButtonLink variant="link" href={`/trips/${trip.id}`} data-open={trip.id} data-trip-link={trip.id}>Open trip</ButtonLink>
        {booking?.total ? (
          <ButtonLink variant="link" className={booking.overdue ? styles.urgent : undefined} href={`/trips/${trip.id}?view=bookings`} data-trip-link={trip.id} data-booking-link={trip.id}>
            Bookings {booking.total}{booking.overdue ? ` · ${booking.overdue} overdue` : ""}
          </ButtonLink>
        ) : null}
        {trip.atlasLocation ? (
          <Button variant="link" onClick={onShowOnGlobe}>Show on globe</Button>
        ) : canManage(trip.role) ? (
          <ButtonLink variant="link" href={`/trips/${trip.id}#globe-location`} data-trip-link={trip.id}>Set globe location</ButtonLink>
        ) : (
          <span className="muted">Not on the globe</span>
        )}
      </div>
    </li>
  );
}
