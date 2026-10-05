"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { api } from "@/lib/api";
import { useInlineField } from "@/lib/use-inline-field";
import { TimeZoneSelect } from "../TimeZoneSelect/TimeZoneSelect";
import { zoneLabel } from "../TimeZoneSelect/zones";
import { impactBlocks, ZoneImpact, type Choice, type Impact } from "../ZoneImpact/ZoneImpact";
import { saveTripFields, tripFailure } from "../trip-edit";

type Props = { tripId: string; zone: string; version: number; onDirty: (key: string, dirty: boolean) => void };

/**
 * DASH-6, TRIP-4: the trip's time zone, edited in place. Save first shows what the change does to event times and
 * booking dates (and asks which of a repeated time is meant); Confirm and save then makes it.
 */
export function ZoneSection({ tripId, zone, version, onDirty }: Props) {
  const router = useRouter();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useInlineField<string>({
    read: () => zone,
    save: async (next, start) => {
      const r = await saveTripFields(tripId, { timeZone: next }, { timeZone: start }, { confirmTimeZoneImpact: true, timeDisambiguationByItem: choices });
      if (!r.ok) return tripFailure(r);
      router.refresh();
      return { ok: true };
    },
  });
  useEffect(() => onDirty("zone", field.dirty), [field.dirty, onDirty]);

  async function save() {
    if (field.draft === zone) return field.cancel();
    if (impact) {
      const done = await field.commit();
      if (done) setImpact(null);
      return;
    }
    setChecking(true);
    setProblem(null);
    const p = await api<Impact>("POST", `/api/trips/${tripId}/time-zone-preview`, { timeZone: field.draft, expectedVersion: version });
    setChecking(false);
    if (!p.ok) { setProblem(p.message); return; }
    setImpact(p.data);
  }

  const status = checking ? { state: "saving" as const } : problem ? { state: "error" as const, message: problem } : field.status;
  return (
    <EditSection
      title="Time zone"
      canEdit
      editing={field.editing}
      onEdit={() => { setImpact(null); setChoices({}); setProblem(null); field.open(); }}
      onCancel={() => { setImpact(null); field.cancel(); }}
      onSave={() => void save()}
      saveLabel={impact ? "Confirm and save" : "Save"}
      status={status}
      saveDisabled={impactBlocks(impact, choices)}
      view={<p>{zoneLabel(zone)}</p>}
    >
      <TimeZoneSelect
        id="td-timeZone"
        value={field.draft}
        onChange={(z) => { field.setDraft(z); setImpact(null); setChoices({}); setProblem(null); }}
        place={null}
        currentZone={zone}
        fromPlace={false}
        error={field.error("timeZone")}
        errorId="td-timeZone-err"
      />
      {impact ? <ZoneImpact impact={impact} zone={field.draft} choices={choices} onChoose={(id, c) => setChoices((o) => ({ ...o, [id]: c }))} /> : null}
    </EditSection>
  );
}
