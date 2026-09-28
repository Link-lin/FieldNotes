"use client";

import { useState } from "react";
import type { PlanItemDTO } from "@/shared/dto";
import { embedTarget, googleEmbedUrl } from "@/shared/map-links";
import styles from "./EventMap.module.css";

type Props = { item: PlanItemDTO; destination: string; mapsKey: string | null };

/**
 * MAP-8: a live Google map of the event, loaded only when its side panel opens. The frame sends
 * only this site's origin as the referrer (for the key's site restriction), never the trip address.
 */
export function EventMap({ item, destination, mapsKey }: Props) {
  const target = embedTarget(item, destination);
  const [loaded, setLoaded] = useState(false);

  if (!target) {
    return (
      <div className={styles.empty}>
        <p>No place on this event yet.</p>
        <p className="note">Add a place name or a map link to see it on a map.</p>
      </div>
    );
  }
  if (!mapsKey) return null;

  const label = target.mode === "directions" ? `${target.origin} to ${target.destination}` : (item.location ?? target.q);
  return (
    <figure className={styles.map} data-loaded={loaded || undefined}>
      <div className={styles.frame}>
        <iframe
          title={`Google map: ${label}`}
          src={googleEmbedUrl(mapsKey, target)}
          referrerPolicy="origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          allowFullScreen
          onLoad={() => setLoaded(true)}
        />
        <span className={styles.loading} aria-hidden="true">Loading map…</span>
      </div>
      <figcaption className="note">Map by Google. Opening an event sends its place to Google.</figcaption>
    </figure>
  );
}
