"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LatLon, PlaceDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { Field } from "@/components/ui/Field/Field";
import { api } from "@/lib/api";
import { useInlineField } from "@/lib/use-inline-field";
import { saveTripFields, tripFailure } from "../trip-edit";
import styles from "./GlobePoint.module.css";

type Props = {
  tripId: string;
  point: (LatLon & { source: "owner" | "catalog" }) | null;
  /** Whoever set it: this person, or another owner. */
  setByYou: boolean;
  startOpen?: boolean;
  onDirty: (key: string, dirty: boolean) => void;
};

const at = (p: LatLon) => `${Math.abs(p.latitude).toFixed(2)}° ${p.latitude >= 0 ? "N" : "S"}, ${Math.abs(p.longitude).toFixed(2)}° ${p.longitude >= 0 ? "E" : "W"}`;

/** ATLAS-4: where the trip sits on the dashboard globe, chosen from the bundled place list (nothing is sent out). */
export function GlobePoint({ tripId, point, setByYou, startOpen = false, onDirty }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceDTO[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const start = point ? { latitude: point.latitude, longitude: point.longitude } : null;
  const save = async (next: LatLon | null, from: LatLon | null) => {
    const r = await saveTripFields(tripId, { atlasLocation: next }, { atlasLocation: from });
    if (!r.ok) return tripFailure(r);
    router.refresh();
    return { ok: true as const };
  };
  const field = useInlineField<LatLon | null>({
    initiallyOpen: startOpen,
    read: () => start,
    save: async (next, from) => {
      const r = await save(next, from);
      return r.ok ? { ok: true, note: next ? `Point saved${label ? `: ${label}` : ""}.` : "Point removed.", undo: () => save(from, next) } : r;
    },
  });
  useEffect(() => onDirty("globe", field.dirty), [field.dirty, onDirty]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await api<{ places: PlaceDTO[] }>("GET", `/api/atlas/places?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setResults(r.data.places);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const picked = field.draft;
  return (
    <EditSection
      title="Globe point"
      canEdit
      editing={field.editing}
      onEdit={() => { setQ(""); setResults([]); setLabel(null); field.open(); }}
      onCancel={field.cancel}
      onSave={() => void field.commit()}
      status={field.status}
      onUndo={() => void field.undo()}
      saveLabel="Save point"
      view={
        <div className={styles.view}>
          {point ? (
            <>
              <p className={styles.coords}>{at(point)}</p>
              <p className="note">{point.source === "owner" ? (setByYou ? "Point set by you." : "Point set by an owner.") : "Approximate destination, matched from the bundled place list."}</p>
              <div><Button variant="quiet" onClick={() => void field.saveNow(null)}>Remove point</Button></div>
            </>
          ) : (
            <p className="note">This trip has no point yet, so it appears in the list only. Edit to pick a place and show it on the globe.</p>
          )}
        </div>
      }
    >
      <Field label="Search places (bundled list, nothing is sent out)" htmlFor="td-place">
        <input id="td-place" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try Ushuaia or Santiago" autoComplete="off" />
      </Field>
      {q.trim().length >= 2 && results.length ? (
        <div className={styles.results} role="group" aria-label="Matching places">
          {results.map((r) => {
            const on = !!picked && picked.latitude === r.latitude && picked.longitude === r.longitude;
            return <button key={r.id} type="button" aria-pressed={on} onClick={() => { setLabel(r.label); field.setDraft({ latitude: r.latitude, longitude: r.longitude }); }}>{r.label}</button>;
          })}
        </div>
      ) : q.trim().length >= 2 ? (
        <p className="note">No match. Try a nearby city.</p>
      ) : null}
      {picked ? <p className="note">{label ? `${label}: ` : "Current point: "}{at(picked)}</p> : null}
    </EditSection>
  );
}
