import type { TripSummaryDTO } from "@/shared/dto";
import { cx } from "@/lib/cx";
import { STATUS_LABEL } from "@/lib/format";
import type { Filter } from "../TripList";
import styles from "./TripFilters.module.css";

const FILTERS = ["all", "upcoming", "ongoing", "past"] as const;

/** Toggle buttons for All, Upcoming, Ongoing and Past, each with its count. */
export function TripFilters({ trips, value, onChange }: { trips: TripSummaryDTO[]; value: Filter; onChange: (f: Filter) => void }) {
  const count = (f: Filter) => trips.filter((t) => f === "all" || t.status === f).length;
  return (
    <div className={cx("mono", styles.filters)} role="group" aria-label="Filter trips by date status">
      {FILTERS.map((f) => (
        <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)}>
          {f === "all" ? "All" : STATUS_LABEL[f]} {count(f)}
        </button>
      ))}
    </div>
  );
}
