"use client";

import { useMemo, useState } from "react";
import type { PlaceDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { commonZones, offsetMinutes, zoneLabel } from "./zones";
import styles from "./TimeZoneSelect.module.css";

function allZoneIds(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

const REGIONS: Array<[string, string]> = [
  ["Africa", "Africa"], ["America", "Americas"], ["Antarctica", "Antarctica"], ["Arctic", "Arctic"], ["Asia", "Asia"],
  ["Atlantic", "Atlantic Ocean"], ["Australia", "Australia"], ["Europe", "Europe"], ["Indian", "Indian Ocean"], ["Pacific", "Pacific Ocean"],
];

/** Every zone, by region, west to east within a region. */
function groupedZones(all: string[]): Array<{ label: string; zones: Array<{ id: string; label: string }> }> {
  const groups = new Map<string, Array<{ id: string; label: string; off: number }>>();
  for (const z of all) {
    const region = REGIONS.find(([k]) => z.startsWith(`${k}/`))?.[1] ?? "Other";
    groups.set(region, [...(groups.get(region) ?? []), { id: z, label: zoneLabel(z), off: offsetMinutes(z) ?? 0 }]);
  }
  return [...REGIONS.map(([, l]) => l), "Other"]
    .filter((l) => groups.has(l))
    .map((l) => ({ label: l, zones: groups.get(l)!.sort((a, b) => a.off - b.off || a.label.localeCompare(b.label)) }));
}

type Props = {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  /** Destination picked from the suggestions; its zones are offered first. */
  place: PlaceDTO | null;
  /** The trip's saved zone when editing. */
  currentZone: string | null;
  /** True when the value was set from the destination and not changed by hand. */
  fromPlace: boolean;
  error?: string;
};

/**
 * Trip time zone: the destination's zones and this device's zone on top, then a short list of
 * about 60 zones by offset ("GMT-7 · Los Angeles, Vancouver"), with every IANA zone one click away.
 */
export function TimeZoneSelect({ id, value, onChange, place, currentZone, fromPlace, error }: Props) {
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const allIds = useMemo(() => allZoneIds(), []);
  const regions = useMemo(() => groupedZones(allIds), [allIds]);
  const shortList = useMemo(() => commonZones(), []);
  const [showAll, setShowAll] = useState(false);

  const suggested = place?.timeZones ?? [];
  const above = new Set([...suggested, browserZone, ...(currentZone ? [currentZone] : [])]);
  const main = showAll ? regions : [{ label: "Time zones", zones: shortList }];
  const listed = new Set([...above, ...main.flatMap((g) => g.zones.map((z) => z.id))]);
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;

  const hint = (
    <>
      {place && suggested.length && fromPlace && value === suggested[0]
        ? suggested.length > 1
          ? `Set from ${place.label}, which has ${suggested.length} time zones. Pick the one where most of the trip happens.`
          : `Set from ${place.label}.`
        : "Book-by dates and times without their own zone use this zone."}{" "}
      <Button variant="link" className={styles.toggle} onClick={() => setShowAll((x) => !x)} aria-controls={id}>
        {showAll ? "Show fewer" : `Not listed? Show all ${allIds.length}`}
      </Button>
    </>
  );

  return (
    <Field label="Trip time zone" htmlFor={id} wide hint={hint} hintId={hintId} error={error} errorId={errId}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={error ? errId : hintId} aria-invalid={error ? true : undefined}>
        {place && suggested.length ? (
          <optgroup label={`Suggested for ${place.label}`}>
            {suggested.map((z) => <option key={`s-${z}`} value={z}>{zoneLabel(z)}</option>)}
          </optgroup>
        ) : null}
        {!suggested.includes(browserZone) ? (
          <optgroup label="This device">
            <option value={browserZone}>{zoneLabel(browserZone)}</option>
          </optgroup>
        ) : null}
        {currentZone && currentZone !== browserZone && !suggested.includes(currentZone) ? (
          <optgroup label="Current">
            <option value={currentZone}>{zoneLabel(currentZone)}</option>
          </optgroup>
        ) : null}
        {!listed.has(value) ? (
          <optgroup label="Selected">
            <option value={value}>{zoneLabel(value)}</option>
          </optgroup>
        ) : null}
        {main.map((g) => (
          <optgroup key={g.label} label={showAll ? `All time zones · ${g.label}` : g.label}>
            {g.zones.filter((z) => !above.has(z.id)).map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}
