"use client";

import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field/Field";
import { InlineEdit } from "@/components/ui/InlineEdit/InlineEdit";
import { useInlineField } from "@/lib/use-inline-field";
import { saveTripFields, tripFailure } from "../trip-edit";

type Props = {
  tripId: string;
  title: string;
  canEdit: boolean;
  as: "h1" | "h2";
  headingId?: string;
  className?: string;
  /** The heading can take focus from script, as the page's focus fallback (the trip page's h1). */
  focusable?: boolean;
};

/** The trip's name, edited where it is shown (DASH-6): on the trip page's header and in the trip details. */
export function TripTitleField({ tripId, title, canEdit, as, headingId, className, focusable = false }: Props) {
  const router = useRouter();
  const field = useInlineField({
    read: () => title,
    save: async (next, start) => {
      const r = await saveTripFields(tripId, { title: next }, { title: start });
      if (!r.ok) return tripFailure(r);
      router.refresh();
      return { ok: true };
    },
  });
  return (
    <InlineEdit
      label="Trip name"
      valueText={title}
      as={as}
      headingId={headingId}
      className={className}
      focusable={focusable}
      canEdit={canEdit}
      editing={field.editing}
      onEdit={field.open}
      onCommit={() => void field.commit()}
      onCancel={field.cancel}
      status={field.status}
      controls={({ describedBy }) => (
        <Field label="Trip name" htmlFor={`${headingId ?? "trip"}-name`} error={field.error("title")}>
          <input id={`${headingId ?? "trip"}-name`} value={field.draft} maxLength={120} onChange={(e) => field.setDraft(e.target.value)} aria-describedby={describedBy} aria-invalid={field.error("title") ? true : undefined} />
        </Field>
      )}
    >
      {title}
    </InlineEdit>
  );
}
