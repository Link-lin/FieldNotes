import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { errorId, fieldId, type BookingDraft } from "../event-edit";

type Props = {
  value: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  error: (path: string) => string | undefined;
  isFlight: boolean;
  /** FLIGHT-2: a flight can be Booked only with both airports, local times and zones. */
  flightReady: boolean;
  describedBy?: string;
};

/** Whether an event needs booking, by when, or is booked (BOOK-1, BOOK-2). */
export function BookingFields({ value: v, onChange, error, isFlight, flightReady, describedBy }: Props) {
  const described = (path: string) => [error(path) ? errorId(path) : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <FieldGrid>
      <Field label="Booking" htmlFor={fieldId("bookingStatus")} error={error("bookingStatus")} errorId={errorId("bookingStatus")}>
        <select id={fieldId("bookingStatus")} value={v.status} onChange={(e) => onChange({ status: e.target.value as BookingDraft["status"] })} aria-invalid={error("bookingStatus") ? true : undefined} aria-describedby={described("bookingStatus")}>
          {!isFlight ? <option value="not_required">Nothing to book</option> : null}
          <option value="needs_booking">Needs booking</option>
          <option value="booked" disabled={isFlight && !flightReady && v.status !== "booked"}>
            {isFlight && !flightReady ? "Booked (add both airports and times first)" : "Booked"}
          </option>
        </select>
      </Field>
      {v.status === "needs_booking" ? (
        <Field label={<>Book by <span className="muted">optional</span></>} htmlFor={fieldId("bookingDueDate")} error={error("bookingDueDate")} errorId={errorId("bookingDueDate")}>
          <input id={fieldId("bookingDueDate")} type="date" value={v.due} onChange={(e) => onChange({ due: e.target.value })} aria-invalid={error("bookingDueDate") ? true : undefined} aria-describedby={described("bookingDueDate")} />
        </Field>
      ) : null}
    </FieldGrid>
  );
}
