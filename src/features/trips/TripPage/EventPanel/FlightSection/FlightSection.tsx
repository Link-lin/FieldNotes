"use client";

import { useEffect } from "react";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { fmtShort } from "@/lib/format";
import { useInlineField } from "@/lib/use-inline-field";
import { FlightCard } from "../../FlightCard/FlightCard";
import { flightDraftOf, flightFields, saveEventFields, saveFailure, type FlightDraft } from "../event-edit";
import { FlightFields } from "../FlightFields/FlightFields";

type Props = { trip: TripDetailDTO["trip"]; item: PlanItemDTO; canEdit: boolean; onSaved: (item: PlanItemDTO) => void; onDirty: (key: string, dirty: boolean) => void };

/** A flight segment's carrier, airports and local times, edited in place as one section (TRIP-10, FLIGHT-2). */
export function FlightSection({ trip, item, canEdit, onSaved, onDirty }: Props) {
  const save = async (next: FlightDraft, start: FlightDraft) => {
    const r = await saveEventFields(trip.id, item.id, flightFields(next), flightFields(start));
    if (!r.ok) return saveFailure(r);
    onSaved(r.item);
    return r;
  };
  const field = useInlineField<FlightDraft>({
    read: () => flightDraftOf(item),
    save: async (next, start) => {
      const r = await save(next, start);
      if (!r.ok) return r;
      const day = (d: FlightDraft) => (d.dep.dt ? d.dep.dt.slice(0, 10) : d.plannedDate) || null;
      if (day(start) === day(next)) return { ok: true };
      const to = day(next);
      return { ok: true, note: to ? `Moved to ${fmtShort(to)}.` : "Moved to Undated flights.", undo: () => save(start, next) };
    },
  });
  useEffect(() => onDirty("flight", field.dirty), [field.dirty, onDirty]);

  return (
    <EditSection
      title="Flight"
      canEdit={canEdit}
      editing={field.editing}
      onEdit={field.open}
      onCancel={field.cancel}
      onSave={() => void field.commit()}
      status={field.status}
      onUndo={() => void field.undo()}
      view={<FlightCard item={item} />}
    >
      <FlightFields value={field.draft} onChange={(patch) => field.setDraft((d) => ({ ...d, ...patch }))} error={field.error} bookedNote={item.bookingStatus === "booked"} />
    </EditSection>
  );
}
