"use client";

import { useState } from "react";
import { googleDayUrl, haversineKm } from "@/shared/map-links";
import { ButtonLink } from "@/components/ui/Button/Button";
import { cx } from "@/lib/cx";
import { fmtDay } from "@/lib/format";
import type { Stop } from "../trip-days";
import { DayMap } from "./DayMap/DayMap";
import { GoogleRoadMap } from "./GoogleRoadMap/GoogleRoadMap";
import { km, StopList } from "./StopList/StopList";
import styles from "./MapPanel.module.css";

/** The sticky map column: bundled outline, plus an opt-in Google road route on a day tab. */
export function MapPanel({ day, stops, onPin, mapsKey }: { day: string; stops: Stop[]; onPin: (id: string) => void; mapsKey: string | null }) {
  const all = day === "all";
  // TripPage keys this component by day, so changing days restores the local view.
  const [showRoad, setShowRoad] = useState(false);
  const road = !all && showRoad && !!mapsKey && stops.length > 0;
  const legs = stops.map((s, i) => {
    const prev = stops[i - 1];
    const same = !!prev && prev.day === s.day && !prev.flight && !s.flight;
    return { s, same, d: same ? haversineKm([prev!.lat, prev!.lon], [s.lat, s.lon]) : 0, chip: all && (!prev || prev.day !== s.day) };
  });
  const total = legs.reduce((sum, leg) => sum + leg.d, 0);
  return (
    <aside className={styles.aside} data-whole={all || undefined} aria-label="Map">
      <div className={styles.card}>
        <div className={cx("mono", styles.cap)}>
          <span>{road ? "Road map · Google" : "Outline map · no streets"}</span>
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
        {!all && stops.length && mapsKey ? (
          <div className={styles.views} aria-label="Map view">
            <button type="button" aria-pressed={!road} onClick={() => setShowRoad(false)}>Outline</button>
            <button type="button" aria-pressed={road} onClick={() => setShowRoad(true)}>Road route</button>
          </div>
        ) : null}
        {road && mapsKey ? <GoogleRoadMap key={day} stops={stops} apiKey={mapsKey} /> : <DayMap key={day} stops={stops} onPin={onPin} />}
        <StopList legs={legs} />
        {total > 0 ? <p className="note">About {km(total)} in straight lines between stops on the same day. Flights are not counted.</p> : null}
        {stops.length ? (
          <p className="note">{road
            ? "The road route is provided by Google. Stop-list distances remain straight-line estimates."
            : `Zoom with + and −, the wheel or a pinch, and drag to move. Coastlines, borders and cities are approximate; pins come from saved map links.${all ? " Choose a day to see its road route." : mapsKey ? " Opening Road route sends this day's pinned coordinates to Google." : ""}`}</p>
        ) : null}
      </div>
    </aside>
  );
}
