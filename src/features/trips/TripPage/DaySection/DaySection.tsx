import { PlusIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import styles from "./DaySection.module.css";

type Props = {
  title: string;
  titleId?: string;
  /** Small caps line on the right: "Day 03 of 10", "No date yet". */
  meta: React.ReactNode;
  /** Highlight the meta line (outside the trip dates). */
  outside?: boolean;
  empty?: boolean;
  note?: React.ReactNode;
  /** Shows the dashed "Add an event to this day" row (people who can edit). */
  onAdd?: () => void;
  addKey?: string;
  /** The date this section is for; hovering or focusing its heading points the map at that day. */
  highlightDay?: string;
  className?: string;
  children?: React.ReactNode;
};

/** One day of the itinerary, or the Undated / Undated flights / Recently deleted blocks after the last day. */
export function DaySection({ title, titleId, meta, outside, empty, note, onAdd, addKey, highlightDay, className, children }: Props) {
  return (
    <section className={cx(styles.day, className)} data-empty={empty} data-outside={outside} aria-label={titleId ? undefined : title} aria-labelledby={titleId}>
      <div className={styles.head} data-hl-day={highlightDay}>
        <h2 id={titleId}>{title}</h2>
        <span className={cx("mono", styles.meta)}>{meta}</span>
      </div>
      {note ? <p className="note">{note}</p> : null}
      {children}
      {onAdd ? (
        <button className={styles.add} type="button" data-add-day={addKey} onClick={onAdd}>
          <PlusIcon /> Add an event to this day
        </button>
      ) : null}
    </section>
  );
}

/** "· Today" after a date. */
export function TodayMark() {
  return <span className={styles.today}> · Today</span>;
}

/** The "Unscheduled" heading between timed and date-only events of a day (PLAN-1). */
export function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className={cx("mono", styles.sub)}>{children}</h3>;
}
