"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TripDetailDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { EditIcon, PlusIcon, StatusIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { dashboardUrl } from "@/features/dashboard/dashboard-return";
import { cx } from "@/lib/cx";
import { dateRangeLabel, STATUS_LABEL } from "@/lib/format";
import { Stamp } from "./Stamp/Stamp";
import styles from "./TripHeader.module.css";

type Props = { trip: TripDetailDTO["trip"]; owner: boolean; onAdd: () => void; onEdit: () => void };

/** Back to all trips, dates and zone, status and role, the title, and the owner's actions. */
export function TripHeader({ trip, owner, onAdd, onEdit }: Props) {
  const router = useRouter();
  return (
    <>
      <Link
        className={cx("mono", styles.back)}
        href="/"
        onClick={(e) => {
          // Return to the dashboard as it was (filter, scroll, focus on this trip; TRIP-1).
          const url = dashboardUrl();
          if (url !== "/") {
            e.preventDefault();
            router.push(url);
          }
        }}
      >
        ← All trips
      </Link>
      <header className={styles.head}>
        <div className={styles.meta}>
          <span className="mono">{dateRangeLabel(trip)} · {trip.timeZone}</span>
          <Tag tone={trip.status}><StatusIcon status={trip.status} />{STATUS_LABEL[trip.status]}</Tag>
          <Tag tone="soft">{owner ? "Owner" : `Viewer${trip.ownerName ? `, shared by ${trip.ownerName}` : ""}`}</Tag>
        </div>
        <Stamp city={trip.destination.split(",")[0] ?? trip.destination} start={trip.startDate} days={trip.dayCount} status={trip.status} />
        <h1 className={styles.title} id="trip-title" tabIndex={-1}>{trip.title}</h1>
        <p className={styles.dest}>{trip.destination}</p>
        <div className={styles.actions}>
          {owner ? (
            <>
              <Button variant="fill" data-add-top onClick={onAdd}><PlusIcon /> Add to itinerary</Button>
              <Button data-edit-trip onClick={onEdit}><EditIcon /> Edit trip</Button>
            </>
          ) : null}
          {trip.atlasLocation ? <ButtonLink variant={owner ? "quiet" : "outline"} href={`/?focus=${trip.id}`}>Show on globe</ButtonLink> : null}
        </div>
      </header>
    </>
  );
}
