import styles from "./TripViewNav.module.css";

export type TripView = "itinerary" | "bookings";

type Props = {
  selected: TripView;
  toBook: number;
  overdue: number;
  onSelect: (view: TripView) => void;
};

/** Keep the two main trip jobs visible without placing every booking task above the itinerary. */
export function TripViewNav({ selected, toBook, overdue, onSelect }: Props) {
  return (
    <nav className={styles.nav} aria-label="Trip sections">
      <button type="button" className={styles.link} aria-pressed={selected === "itinerary"} onClick={() => onSelect("itinerary")}>Itinerary</button>
      <button type="button" className={styles.link} aria-pressed={selected === "bookings"} onClick={() => onSelect("bookings")}>Bookings <span className={styles.count}>{toBook}</span>{overdue ? <span className={styles.overdue}>{overdue} overdue</span> : null}</button>
    </nav>
  );
}
