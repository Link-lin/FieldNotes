"use client";

import { useEffect } from "react";
import type { PlanItemDTO } from "@/shared/dto";
import { Field } from "@/components/ui/Field/Field";
import { InlineEdit } from "@/components/ui/InlineEdit/InlineEdit";
import { useInlineField } from "@/lib/use-inline-field";
import { errorId, fieldId, saveEventFields, saveFailure } from "../event-edit";
import styles from "./EventTitle.module.css";

type Props = {
  tripId: string;
  item: PlanItemDTO;
  canEdit: boolean;
  headingId: string;
  /** Opened with the row menu's Edit event: start with the title open. */
  startOpen?: boolean;
  onSaved: (item: PlanItemDTO) => void;
  onDirty: (key: string, dirty: boolean) => void;
};

/** The event's title, edited where it is shown (TRIP-10): Enter or leaving the field saves, Escape goes back. */
export function EventTitle({ tripId, item, canEdit, headingId, startOpen = false, onSaved, onDirty }: Props) {
  // Opened from the row menu's Edit event: the title starts open (the panel focuses it).
  const field = useInlineField({
    initiallyOpen: startOpen && canEdit,
    read: () => item.title,
    save: async (next, start) => {
      const r = await saveEventFields(tripId, item.id, { title: next }, { title: start });
      if (!r.ok) return saveFailure(r);
      onSaved(r.item);
      return { ok: true };
    },
  });
  useEffect(() => onDirty("title", field.dirty), [field.dirty, onDirty]);
  return (
    <InlineEdit
      label="Event title"
      valueText={item.title}
      as="h2"
      headingId={headingId}
      className={styles.title}
      canEdit={canEdit}
      editing={field.editing}
      onEdit={field.open}
      onCommit={() => void field.commit()}
      onCancel={field.cancel}
      status={field.status}
      controls={({ describedBy }) => (
        <Field label="Event title" htmlFor={fieldId("title")} className={styles.field} error={field.error("title")} errorId={errorId("title")}>
          <textarea id={fieldId("title")} rows={1} value={field.draft} maxLength={200} onChange={(e) => field.setDraft(e.target.value)} aria-describedby={[field.error("title") ? errorId("title") : null, describedBy].filter(Boolean).join(" ")} aria-invalid={field.error("title") ? true : undefined} />
        </Field>
      )}
    >
      {item.title}
    </InlineEdit>
  );
}
