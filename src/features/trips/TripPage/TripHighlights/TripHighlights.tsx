import type { TripDetailDTO } from "@/shared/dto";
import { formatMoney } from "@/shared/money";
import { relativeLabel } from "@/lib/format";
import styles from "./TripHighlights.module.css";

/** Two useful facts above the itinerary; the day tabs and map carry the other counts. */
export function TripHighlights({ data }: { data: TripDetailDTO }) {
  const { trip, budgetComparison: comparison, plannedTotals } = data;
  const timing = trip.status === "upcoming"
    ? { value: `${trip.daysToStart} ${trip.daysToStart === 1 ? "day" : "days"}`, label: "until departure" }
    : trip.status === "ongoing"
      ? { value: `Day ${trip.dayIndex} of ${trip.dayCount}`, label: "travelling now" }
      : { value: relativeLabel(trip), label: "trip ended" };

  return (
    <div className={styles.highlights} aria-label="Trip highlights">
      <span className={styles.fact}><strong>{timing.value}</strong><span>{timing.label}</span></span>
      {comparison ? (
        <span className={styles.fact} data-over={comparison.over || undefined}>
          <strong>{formatMoney(comparison.planned, comparison.currency)}</strong>
          <span>{comparison.currency} planned · {formatMoney(comparison.budget, comparison.currency)} budget{comparison.over ? " · over budget" : ""}</span>
        </span>
      ) : plannedTotals.length === 1 ? (
        <span className={styles.fact}><strong>{formatMoney(plannedTotals[0]!.total, plannedTotals[0]!.currency)}</strong><span>planned in {plannedTotals[0]!.currency}</span></span>
      ) : plannedTotals.length > 1 ? (
        <span className={styles.fact}><strong>{plannedTotals.length} currencies</strong><span>planned separately</span></span>
      ) : null}
    </div>
  );
}
