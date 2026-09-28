import { useMemo } from "react";
import type { BookingTaskDTO, TripSummaryDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { PlusIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import { TripCard } from "./TripCard/TripCard";
import { TripFilters } from "./TripFilters/TripFilters";
import styles from "./TripList.module.css";

export type Filter = "all" | "upcoming" | "ongoing" | "past";
const ORDER = { ongoing: 0, upcoming: 1, past: 2 } as const;

type Props = {
  trips: TripSummaryDTO[];
  bookingTasks: BookingTaskDTO[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  selectedId: string | null;
  onShowOnGlobe: (id: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  className?: string;
};

/** ATLAS-2: every trip the viewer may see, filtered by status; ongoing first, then upcoming, then past. */
export function TripList({ trips, bookingTasks, filter, onFilter, selectedId, onShowOnGlobe, canCreate, onCreate, className }: Props) {
  const bookingByTrip = useMemo(() => {
    const counts = new Map<string, { total: number; overdue: number }>();
    for (const task of bookingTasks) {
      const count = counts.get(task.tripId) ?? { total: 0, overdue: 0 };
      count.total++;
      if (task.state === "overdue") count.overdue++;
      counts.set(task.tripId, count);
    }
    return counts;
  }, [bookingTasks]);
  const sorted = useMemo(
    () =>
      trips
        .filter((t) => filter === "all" || t.status === filter)
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === "past" ? (a.startDate < b.startDate ? 1 : -1) : a.startDate < b.startDate ? -1 : 1)),
    [trips, filter],
  );
  return (
    <section className={cx(styles.col, className)} aria-labelledby="list-title">
      <div className={styles.head}>
        <h2 id="list-title" tabIndex={-1}>On your itinerary</h2>
        <TripFilters trips={trips} value={filter} onChange={onFilter} />
      </div>
      <div className={styles.body}>
        {trips.length === 0 ? (
          <div className={styles.empty}>
            <b>No trips yet</b>
            {canCreate ? (
              <>
                <span>Create your first trip to start planning.</span>
                <Button variant="fill" onClick={onCreate}><PlusIcon /> New trip</Button>
                <ButtonLink href="/import">Create from an AI plan</ButtonLink>
              </>
            ) : (
              <span>Trips shared with you will appear here after you accept an invitation.</span>
            )}
          </div>
        ) : sorted.length === 0 ? (
          <p className="note">No trips in this view. Try another filter.</p>
        ) : (
          <ul className={styles.list}>
            {sorted.map((t, i) => (
              <TripCard key={t.id} trip={t} booking={bookingByTrip.get(t.id)} index={i} selected={t.id === selectedId} onShowOnGlobe={() => onShowOnGlobe(t.id)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
