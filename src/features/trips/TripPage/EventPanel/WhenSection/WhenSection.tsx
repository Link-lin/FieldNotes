"use client";

import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { fmtDay, fmtShort } from "@/lib/format";
import { useInlineField } from "@/lib/use-inline-field";
import { dayTag, eventTimeText } from "../../trip-days";
import { saveEventFields, saveFailure, whenDraftOf, whenFields, type WhenDraft } from "../event-edit";
import { WhenFields } from "../WhenFields/WhenFields";
import styles from "./WhenSection.module.css";

type Props = { trip: TripDetailDTO["trip"]; item: PlanItemDTO; canEdit: boolean; onSaved: (item: PlanItemDTO) => void };

/** When a non-flight event happens, edited in place as one section (TRIP-10). A move to another day offers Undo. */
export function WhenSection({ trip, item, canEdit, onSaved }: Props) {
  const save = async (next: WhenDraft, start: WhenDraft) => {
    const r = await saveEventFields(trip.id, item.id, whenFields(next), whenFields(start));
    if (!r.ok) return saveFailure(r);
    onSaved(r.item);
    return r;
  };
  const field = useInlineField<WhenDraft>({
    read: () => whenDraftOf(item),
    save: async (next, start) => {
      const r = await save(next, start);
      if (!r.ok) return r;
      const from = whenFields(start).localDate;
      const to = whenFields(next).localDate;
      if (from === to) return { ok: true };
      return { ok: true, note: to ? `Moved to ${fmtShort(to)}.` : "Moved to Undated.", undo: () => save(start, next) };
    },
  });

  const date = item.localDate;
  return (
    <EditSection
      title="When"
      canEdit={canEdit}
      editing={field.editing}
      onEdit={field.open}
      onCancel={field.cancel}
      onSave={() => void field.commit()}
      status={field.status}
      onUndo={() => void field.undo()}
      view={
        <div className={styles.lines}>
          <p>{date ? `${dayTag(trip, date)} · ${fmtDay(date)}` : "No date yet. It's listed under Undated."}</p>
          {date ? <p className={styles.sub}>{eventTimeText(item, trip.timeZone)}</p> : null}
        </div>
      }
    >
      <WhenFields value={field.draft} onChange={(patch) => field.setDraft((d) => ({ ...d, ...patch }))} tripZone={trip.timeZone} tripDates={trip} currentZone={item.timeZone} error={field.error} />
    </EditSection>
  );
}
