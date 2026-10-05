import type { Stop } from "../../trip-days";
import { StopNumber } from "../../StopNumber/StopNumber";
import styles from "./StopList.module.css";

export type Leg = { s: Stop; same: boolean; d: number; chip: boolean };

export function km(v: number): string {
  if (v < 1) return `${Math.round((v * 1000) / 10) * 10} m`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} km`;
}

/**
 * The text equivalent of the pins (MAP-5): number, name and straight-line distance from the previous stop. A stop's
 * name opens its event, as its pin does (I10).
 */
export function StopList({ legs, onOpen }: { legs: Leg[]; onOpen: (id: string) => void }) {
  return (
    <ol className={styles.stops}>
      {legs.map(({ s, same, d, chip }) => (
        <StopRow key={s.id} s={s} same={same} d={d} chip={chip} onOpen={onOpen} />
      ))}
    </ol>
  );
}

function StopRow({ s, same, d, chip, onOpen }: Leg & { onOpen: (id: string) => void }) {
  return (
    <>
      {chip ? <li className={styles.dayChip} aria-hidden="true" data-hl-day={s.day}>{s.dayLabel}</li> : null}
      <li className={styles.stop} data-hl={s.id}>
        <StopNumber n={s.n} need={s.need} />
        <button type="button" className={styles.name} data-stop-open={s.id} onClick={() => onOpen(s.id)}>{s.name}</button>
        <small>{same ? `${km(d)} from ${s.n - 1}` : s.flight ? "Flight arrival" : "Start"}</small>
      </li>
    </>
  );
}
