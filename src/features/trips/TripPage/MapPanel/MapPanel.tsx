import { googleDayUrl } from "@/shared/map-links";
import { ButtonLink } from "@/components/ui/Button/Button";
import { cx } from "@/lib/cx";
import { fmtDay } from "@/lib/format";
import type { Stop } from "../trip-days";
import { DayMap } from "./DayMap/DayMap";
import styles from "./MapPanel.module.css";

/** The sticky map column: caption, "Open this day in Google Maps" on a day tab (MAP-6), the sketch map and its help. */
export function MapPanel({ day, stops, onPin }: { day: string; stops: Stop[]; onPin: (id: string) => void }) {
  const all = day === "all";
  return (
    <aside className={styles.aside} aria-label="Map">
      <div className={styles.card}>
        <div className={cx("mono", styles.cap)}>
          <span>Sketch map, no streets</span>
          <b>{all ? "Whole trip" : fmtDay(day)}</b>
        </div>
        {!all && stops.length ? (
          <>
            <ButtonLink external href={googleDayUrl(stops.map((s) => [s.lat, s.lon] as const)) ?? "#"}>
              {stops.length > 1 ? "Open this day in Google Maps" : "Open in Google Maps"} ↗
            </ButtonLink>
            <p className={styles.help}>Opens Google Maps with this day&apos;s pinned locations.{stops.length > 10 ? " Only the first 10 stops are included." : ""}</p>
          </>
        ) : null}
        <DayMap key={day} stops={stops} showDays={all} onPin={onPin} />
        {stops.length ? (
          <p className="note">Zoom with + and −, the wheel or a pinch, and drag to move. Pins come from saved map links; streets are not drawn.{all ? " Choose a day to open its route in Google Maps." : ""}</p>
        ) : null}
      </div>
    </aside>
  );
}
