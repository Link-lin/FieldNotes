"use client";

import { useState } from "react";
import { googleDayEmbedUrl } from "@/shared/map-links";
import type { Stop } from "../../trip-days";
import { routeChunks } from "./road-runs";
import styles from "./GoogleRoadMap.module.css";

/** A user-opened Google road map. The iframe is never mounted in the outline view. */
export function GoogleRoadMap({ stops, apiKey }: { stops: Stop[]; apiKey: string }) {
  const [mode, setMode] = useState<"driving" | "walking">("driving");
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const chunks = routeChunks(stops);
  const segment = chunks[Math.min(segmentIndex, chunks.length - 1)] ?? [stops[0]!];
  const url = googleDayEmbedUrl(apiKey, segment.map((s) => (s.airport ? { airport: s.airport } : ([s.lat, s.lon] as const))), mode)!;
  const route = segment.length > 1;

  return (
    <figure className={styles.roadMap}>
      {route ? (
        <div className={styles.options}>
          {chunks.length > 1 ? (
            <label>
              <span>Route segment</span>
              <select value={Math.min(segmentIndex, chunks.length - 1)} onChange={(event) => setSegmentIndex(Number(event.target.value))}>
                {chunks.map((chunk, index) => (
                  <option key={`${chunk[0]!.id}-${chunk[chunk.length - 1]!.id}`} value={index}>
                    Stops {chunk[0]!.n}–{chunk[chunk.length - 1]!.n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>Travel by</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as "driving" | "walking")}>
              <option value="driving">Driving</option>
              <option value="walking">Walking</option>
            </select>
          </label>
        </div>
      ) : null}
      <div className={styles.frame} data-loaded={loadedUrl === url || undefined}>
        <iframe
          key={url}
          title={route ? `Google road route, stops ${segment[0]!.n} to ${segment[segment.length - 1]!.n}` : `Google road map, stop ${segment[0]!.n}`}
          src={url}
          referrerPolicy="origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          allowFullScreen
          onLoad={() => setLoadedUrl(url)}
        />
        <span className={styles.loading} aria-hidden="true">Loading road map…</span>
      </div>
      <figcaption className="note">
        Map by Google. Opening this view sends its pinned coordinates to Google.
        {route ? " Route markers are Google’s; the numbered stop list below matches the itinerary." : " Add another pinned stop on this day to show a road route."}
        {chunks.length > 1 ? " Flights and long routes are shown in separate segments." : ""}
      </figcaption>
    </figure>
  );
}
