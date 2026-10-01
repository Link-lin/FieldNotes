"use client";

import type { ImportLocationCandidate } from "@/shared/import";
import { openStreetMapPointUrl } from "@/shared/map-links";
import { Button } from "@/components/ui/Button/Button";
import styles from "./MapSuggestion.module.css";

type Lookup = { status: "loading" | "ready" | "error"; candidates: ImportLocationCandidate[]; selected: number | null };

/** A suggested coordinate stays optional and is saved only with the owner's import confirmation. */
export function MapSuggestion({ id, lookup, busy, onSelect, onRetry }: {
  id: number; lookup: Lookup | null; busy: boolean; onSelect: (index: number | null) => void; onRetry: () => void;
}) {
  if (lookup?.status === "loading") return <p className={styles.status} role="status">Finding this place on the map…</p>;
  if (!lookup || lookup.status === "error") return <div className={styles.line}><span className={styles.status}>Map location not found yet.</span><Button variant="quiet" onClick={onRetry} disabled={busy}>Find place</Button></div>;
  if (!lookup.candidates.length) return <div className={styles.line}><span className={styles.status}>No matching place found. This item will stay off the map.</span><Button variant="quiet" onClick={onRetry} disabled={busy}>Retry</Button></div>;
  const chosen = lookup.selected === null ? null : lookup.candidates[lookup.selected];
  return (
    <div className={styles.choice}>
      <label htmlFor={`import-map-${id}`}>Map location</label>
      <select id={`import-map-${id}`} value={lookup.selected ?? ""} onChange={(event) => onSelect(event.target.value === "" ? null : Number(event.target.value))} disabled={busy}>
        <option value="">Do not pin this item</option>
        {lookup.candidates.map((candidate, index) => <option key={`${candidate.latitude}-${candidate.longitude}-${index}`} value={index}>{candidate.label}</option>)}
      </select>
      {chosen ? <a href={openStreetMapPointUrl(chosen.latitude, chosen.longitude)} target="_blank" rel="noopener noreferrer">View this match on a map ↗</a> : null}
      {chosen && !["amenity", "building"].includes(chosen.kind) ? <span className={styles.status}>This is an area or street, not a precise venue.</span> : null}
      {lookup.selected === null ? <span className={styles.status}>Choose a match to pin this stop. Unclear matches are left unpinned.</span> : <span className={styles.status}>Suggested match · review the address before saving.</span>}
    </div>
  );
}
