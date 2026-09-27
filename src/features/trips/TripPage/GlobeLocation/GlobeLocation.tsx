"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaceDTO, TripDetailDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Card } from "@/components/ui/Card/Card";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Section } from "@/components/ui/Section/Section";
import { useToast } from "@/components/ui/Toast/Toast";
import { api } from "@/lib/api";
import styles from "./GlobeLocation.module.css";

/** ATLAS-4: the trip's globe point, and for the owner a search of the bundled place list to set or clear it. */
export function GlobeLocation({ trip, owner }: { trip: TripDetailDTO["trip"]; owner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceDTO[]>([]);
  const [pick, setPick] = useState<PlaceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await api<{ places: PlaceDTO[] }>("GET", `/api/atlas/places?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setResults(r.data.places);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function save(point: { latitude: number; longitude: number } | null) {
    setError(null);
    const r = await api("PATCH", `/api/trips/${trip.id}`, {
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      timeZone: trip.timeZone,
      budget: trip.budget,
      expectedVersion: trip.version,
      atlasLocation: point,
    });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setPick(null);
    setQ("");
    toast({ message: point ? "Globe point saved." : "Globe point cleared." });
    router.refresh();
  }

  const p = trip.atlasLocation;
  return (
    <Section title="Globe location" titleId="globe-title" id="globe-location">
      <Card className={styles.body}>
        {p ? (
          <>
            <p className={styles.coords}>
              {Math.abs(p.latitude).toFixed(2)}° {p.latitude >= 0 ? "N" : "S"}, {Math.abs(p.longitude).toFixed(2)}° {p.longitude >= 0 ? "E" : "W"}
            </p>
            <p className="note">{p.source === "owner" ? (owner ? "Point set by you." : "Point set by the trip owner.") : "Approximate destination, matched from the bundled place list."}</p>
          </>
        ) : (
          <p className="note">This trip has no point yet, so it appears in the list only.{owner ? " Pick a place to show it on the globe." : ""}</p>
        )}
        {owner ? (
          <>
            <Field label="Search places (bundled list, nothing is sent out)" htmlFor="place-q">
              <input id="place-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try Ushuaia or Santiago" autoComplete="off" />
            </Field>
            {q.trim().length >= 2 && results.length ? (
              <div className={styles.results} role="group" aria-label="Matching places">
                {results.map((r) => (
                  <button key={r.id} type="button" aria-pressed={pick?.id === r.id} onClick={() => setPick(r)}>{r.label}</button>
                ))}
              </div>
            ) : q.trim().length >= 2 ? (
              <p className="note">No match. Try a nearby city.</p>
            ) : null}
            {error ? <FormError>{error}</FormError> : null}
            <div className="cluster">
              <Button variant="fill" disabled={!pick} onClick={() => pick && save({ latitude: pick.latitude, longitude: pick.longitude })}>Save point</Button>
              {p ? <Button onClick={() => save(null)}>Clear point</Button> : null}
            </div>
          </>
        ) : (
          <p className="note">Only the owner can change this point.</p>
        )}
      </Card>
    </Section>
  );
}
