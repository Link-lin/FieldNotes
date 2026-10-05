"use client";

import { useRouter } from "next/navigation";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { dateRangeLabel, plural } from "@/lib/format";
import { useInlineField } from "@/lib/use-inline-field";
import { newlyOutside } from "../date-range";
import { saveTripFields, tripFailure } from "../trip-edit";

type Dates = { startDate: string; endDate: string };
type Props = { tripId: string; dates: Dates; dayCount: number; itemDates: string[] };

/** DASH-6: the trip's start and end, edited in place. Events keep their dates; those the new range leaves out are counted. */
export function DatesSection({ tripId, dates, dayCount, itemDates }: Props) {
  const router = useRouter();
  const field = useInlineField<Dates>({
    read: () => ({ startDate: dates.startDate, endDate: dates.endDate }),
    save: async (next, start) => {
      const r = await saveTripFields(tripId, next, start);
      if (!r.ok) return tripFailure(r);
      router.refresh();
      const out = newlyOutside(itemDates, start, next);
      return { ok: true, note: out ? `Saved. ${plural(out, "event")} now ${out === 1 ? "falls" : "fall"} outside the trip dates; ${out === 1 ? "it stays" : "they stay"} on the trip.` : undefined };
    },
  });
  const err = (path: string) => field.error(path);
  const out = field.editing ? newlyOutside(itemDates, dates, field.draft) : 0;

  return (
    <EditSection
      title="Dates"
      canEdit
      editing={field.editing}
      onEdit={field.open}
      onCancel={field.cancel}
      onSave={() => void field.commit()}
      status={field.status}
      view={<p>{dateRangeLabel(dates)} · {plural(dayCount, "day")}</p>}
    >
      <FieldGrid>
        <Field label="Start date" htmlFor="td-startDate" error={err("startDate")} errorId="td-startDate-err">
          <input
            id="td-startDate"
            type="date"
            value={field.draft.startDate}
            onChange={(e) => {
              const startDate = e.target.value;
              // The end date follows the start date, so its picker opens on the right month.
              field.setDraft((d) => ({ startDate, endDate: startDate && (!d.endDate || d.endDate < startDate) ? startDate : d.endDate }));
            }}
            aria-invalid={err("startDate") ? true : undefined}
            aria-describedby={err("startDate") ? "td-startDate-err" : undefined}
          />
        </Field>
        <Field label="End date" htmlFor="td-endDate" error={err("endDate")} errorId="td-endDate-err">
          <input id="td-endDate" type="date" value={field.draft.endDate} min={field.draft.startDate || undefined} onChange={(e) => field.setDraft((d) => ({ ...d, endDate: e.target.value }))} aria-invalid={err("endDate") ? true : undefined} aria-describedby={err("endDate") ? "td-endDate-err" : undefined} />
        </Field>
      </FieldGrid>
      {out ? <p className="note" role="status">{plural(out, "event")} will fall outside these dates. They stay on the trip, marked as outside the trip dates.</p> : null}
    </EditSection>
  );
}
