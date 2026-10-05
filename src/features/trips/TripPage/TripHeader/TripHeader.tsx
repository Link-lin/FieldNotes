"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { EditIcon, PlusIcon, ShareIcon, StatusIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { dashboardUrl } from "@/features/dashboard/dashboard-return";
import { TripTitleField } from "@/features/trips/TripDetails/TripTitleField/TripTitleField";
import { cx } from "@/lib/cx";
import { ROLE_LABEL } from "@/shared/roles";
import { dateRangeLabel, STATUS_LABEL } from "@/lib/format";
import { Stamp } from "./Stamp/Stamp";
import { UpNext } from "./UpNext/UpNext";
import styles from "./TripHeader.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  /** May add events (owners and editors). */
  canEdit: boolean;
  /** May edit the trip and share it (owners). */
  canManage: boolean;
  compact?: boolean;
  /** With these, a wide header also shows the Up next card. */
  items?: PlanItemDTO[];
  onOpenEvent?: (item: PlanItemDTO) => void;
  onAdd: () => void;
  onEdit: () => void;
  onShare: () => void;
};

/**
 * Back to all trips, dates and zone, status and role, the title (an owner changes it in place), the actions your role
 * allows and, when wide, what's up next.
 */
export function TripHeader({ trip, canEdit, canManage, compact = false, items, onOpenEvent, onAdd, onEdit, onShare }: Props) {
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
      <header className={styles.head} data-compact={compact || undefined}>
        <div className={styles.meta}>
          <span className="mono">{dateRangeLabel(trip)} · {trip.timeZone}</span>
          <Tag tone={trip.status}><StatusIcon status={trip.status} />{STATUS_LABEL[trip.status]}</Tag>
          <Tag tone="soft">{ROLE_LABEL[trip.role]}{!trip.primaryOwner && trip.ownerName ? `, shared by ${trip.ownerName}` : ""}</Tag>
        </div>
        {!compact ? <Stamp className={styles.stamp} city={trip.destination.split(",")[0] ?? trip.destination} start={trip.startDate} days={trip.dayCount} status={trip.status} /> : null}
        <TripTitleField tripId={trip.id} title={trip.title} canEdit={canManage} as="h1" headingId="trip-title" className={styles.title} focusable />
        <p className={styles.dest}>{trip.destination}</p>
        <div className={styles.actions}>
          {canEdit ? <Button variant="fill" data-add-top onClick={onAdd}><PlusIcon /> Add to itinerary</Button> : null}
          {canManage ? (
            <>
              <Button data-edit-trip onClick={onEdit}><EditIcon /> Trip details</Button>
              <Button data-share-trip onClick={onShare}><ShareIcon /> Share</Button>
            </>
          ) : null}
          {trip.atlasLocation ? <ButtonLink variant={canEdit ? "quiet" : "outline"} href={`/?focus=${trip.id}`}>Show on globe</ButtonLink> : null}
        </div>
        {!compact && items && onOpenEvent ? <UpNext className={styles.upNext} trip={trip} items={items} onOpen={onOpenEvent} /> : null}
      </header>
    </>
  );
}
