"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportLocationCandidate, ImportLocationResult } from "@/shared/import";
import { coordinatesFromMapUrl, openStreetMapPointUrl, parseCoordinateText, providerLabel } from "@/shared/map-links";
import { Button } from "@/components/ui/Button/Button";
import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { api } from "@/lib/api";
import { errorId, fieldId, type PlaceDraft } from "../event-edit";
import styles from "./PlaceFields.module.css";

type Props = {
  value: PlaceDraft;
  onChange: (patch: Partial<PlaceDraft>) => void;
  error: (path: string) => string | undefined;
  /** Whether place lookup (Geoapify) is set up: Find place on map, and automatic pins for a new place name (MAP-2). */
  placeLookup: boolean;
  isFlight: boolean;
  tripDestination: string;
  /** The event's other links; a map provider's can become its map link. */
  links: Array<{ label: string; url: string }>;
  /** The map link of a pin found automatically from the place name, if the event has one. */
  autoPin: string | null;
  disabled?: boolean;
};

/** Where an event is (MAP-1, MAP-2): its place name, a lookup of that name, and the map link or coordinates that pin it. */
export function PlaceFields({ value: v, onChange, error, placeLookup, isFlight, tripDestination, links, autoPin, disabled = false }: Props) {
  const [finding, setFinding] = useState(false);
  const [matches, setMatches] = useState<ImportLocationCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lookupUrl, setLookupUrl] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  async function findPlace() {
    const location = v.location.trim();
    if (!location) return;
    const mine = ++request.current;
    setFinding(true);
    setMessage(null);
    setMatches([]);
    const result = await api<ImportLocationResult>("POST", "/api/places/resolve", { location, destination: tripDestination });
    if (mine !== request.current) return;
    setFinding(false);
    if (!result.ok) { setMessage(result.message); return; }
    setQuery(location);
    setMatches(result.data.candidates);
    setChosen(result.data.suggestedIndex ?? null);
    if (!result.data.candidates.length) setMessage("No matching place found. Try a more specific place name.");
  }

  // MAP-2: say before saving whether the map field will pin the stop (the server decides on save).
  const mapText = v.mapUrl.trim();
  const pin = mapText ? (parseCoordinateText(mapText) ?? coordinatesFromMapUrl(mapText)) : null;
  const autoPinned = !!autoPin && mapText === autoPin;
  const hint = !mapText
    ? placeLookup
      ? "Use Find place on map above, or paste a Google Maps, Apple Maps or OpenStreetMap link. Coordinates also work. Left empty, a place name with one clear match is pinned automatically after saving."
      : "Paste a Google Maps, Apple Maps or OpenStreetMap link. Coordinates also work."
    : autoPinned
      ? "Pinned automatically from the place name. Paste another link or coordinates to move the pin, or clear this field to remove it."
      : pin
        ? `Pins the stop at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}.`
        : "This link has no coordinates the app can read, so the event won't be on the day map. Try Find place on map above.";
  const imported = links.filter((l) => providerLabel(l.url) && l.url.startsWith("https://") && l.url !== v.mapUrl);
  const match = chosen === null ? null : matches[chosen] ?? null;

  return (
    <FieldGrid>
      <Field label={<>Place <span className="muted">optional</span></>} htmlFor={fieldId("location")} wide error={error("location")} errorId={errorId("location")}>
        <input
          id={fieldId("location")}
          value={v.location}
          maxLength={500}
          placeholder="Fushimi Inari Taisha, Kyoto"
          onChange={(e) => {
            request.current++;
            setFinding(false);
            // A pin found for the old name (here or automatically) doesn't belong to the new one.
            const stale = (lookupUrl && v.mapUrl === lookupUrl) || (autoPin && v.mapUrl === autoPin);
            onChange({ location: e.target.value, ...(stale ? { mapUrl: "" } : {}) });
            setLookupUrl(null);
            setMatches([]);
            setMessage(null);
          }}
        />
      </Field>
      {!isFlight && placeLookup && v.location.trim() ? (
        <div className={styles.finder}>
          <Button variant="quiet" onClick={findPlace} disabled={finding || disabled}>{finding ? "Finding place…" : "Find place on map"}</Button>
          <span className="note">Sends this place and the trip destination to Geoapify. You choose the match before saving.</span>
          {message ? <span className="note" role="status">{message}</span> : null}
          {matches.length && query === v.location.trim() ? (
            <div className={styles.choices}>
              <label htmlFor="ev-place-match">Matching places</label>
              <select id="ev-place-match" value={chosen ?? ""} onChange={(e) => setChosen(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">Choose a place</option>
                {matches.map((m, index) => <option key={`${m.latitude}-${m.longitude}-${index}`} value={index}>{m.label}</option>)}
              </select>
              <Button variant="outline" disabled={!match} onClick={() => { if (match) { const url = openStreetMapPointUrl(match.latitude, match.longitude); setLookupUrl(url); onChange({ mapUrl: url }); } }}>Use this location</Button>
              {match ? <a href={openStreetMapPointUrl(match.latitude, match.longitude)} target="_blank" rel="noopener noreferrer">View this match on a map ↗</a> : null}
              <span className="note"><a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Powered by Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></span>
            </div>
          ) : null}
        </div>
      ) : null}
      <Field label={<>Map link or coordinates <span className="muted">optional</span></>} htmlFor={fieldId("mapUrl")} wide hint={hint} hintId={`${fieldId("mapUrl")}-hint`} error={error("mapUrl")} errorId={errorId("mapUrl")}>
        <input
          id={fieldId("mapUrl")}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={v.mapUrl}
          placeholder="Choose a place above or paste a map link"
          onChange={(e) => { setLookupUrl(null); onChange({ mapUrl: e.target.value }); }}
          aria-invalid={error("mapUrl") ? true : undefined}
          aria-describedby={error("mapUrl") ? errorId("mapUrl") : `${fieldId("mapUrl")}-hint`}
        />
      </Field>
      {imported.length ? (
        <div className={styles.links}>
          <span className="muted">Links on this event:</span>
          <div className="cluster">
            {imported.map((l, i) => (
              <Button key={i} variant="quiet" onClick={() => onChange({ mapUrl: l.url })}>Use {providerLabel(l.url)} link as map link</Button>
            ))}
          </div>
        </div>
      ) : null}
    </FieldGrid>
  );
}
