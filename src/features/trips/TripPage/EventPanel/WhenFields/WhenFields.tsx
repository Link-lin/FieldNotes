import { CheckField, Field, FieldGrid, fieldStyles } from "@/components/ui/Field/Field";
import { TimeZoneSelect } from "@/features/trips/TripDetails/TimeZoneSelect/TimeZoneSelect";
import { zoneLabel } from "@/features/trips/TripDetails/TimeZoneSelect/zones";
import { cx } from "@/lib/cx";
import { fmtShort } from "@/lib/format";
import { errorId, fieldId, type Choice, type WhenDraft } from "../event-edit";
import { ChoiceField } from "../ChoiceField/ChoiceField";

type Props = {
  value: WhenDraft;
  onChange: (patch: Partial<WhenDraft>) => void;
  tripZone: string;
  tripDates: { startDate: string; endDate: string };
  /** The event's saved zone, offered first. */
  currentZone: string | null;
  error: (path: string) => string | undefined;
};

/** When a non-flight event happens (PLAN-1, TIME-1): date or none yet, time, its own zone if not the trip's, duration. */
export function WhenFields({ value: v, onChange, tripZone, tripDates, currentZone, error }: Props) {
  const aria = (path: string) => (error(path) ? { "aria-invalid": true as const, "aria-describedby": errorId(path) } : {});
  const fe = (path: string) => ({ error: error(path), errorId: errorId(path) });
  // I6: saving outside the trip is allowed (parking the night before), but say so while typing.
  const outside = !v.noDate && !!v.date && (v.date < tripDates.startDate || v.date > tripDates.endDate);
  return (
    <FieldGrid>
      <CheckField className={fieldStyles.wide} label="No date yet (shown under Undated)" checked={v.noDate} onChange={(e) => onChange({ noDate: e.target.checked })} />
      {!v.noDate ? (
        <>
          <Field label="Date" htmlFor={fieldId("localDate")} {...fe("localDate")}>
            <input id={fieldId("localDate")} type="date" value={v.date} onChange={(e) => onChange({ date: e.target.value })} {...aria("localDate")} />
          </Field>
          <Field label={<>Time <span className="muted">optional</span></>} htmlFor={fieldId("localTime")} {...fe("localTime")}>
            <input id={fieldId("localTime")} type="time" value={v.time} onChange={(e) => onChange({ time: e.target.value, choice: "" })} {...aria("localTime")} />
          </Field>
          {outside ? (
            <p className={cx("note", fieldStyles.wide)} role="status">
              {fmtShort(v.date)} is outside the trip ({fmtShort(tripDates.startDate)} to {fmtShort(tripDates.endDate)}). You can still save it; it will be listed under Outside trip dates.
            </p>
          ) : null}
          {v.choice || error("timeDisambiguation") ? (
            <ChoiceField id={fieldId("timeDisambiguation")} value={v.choice} onChange={(choice: Choice) => onChange({ choice })} error={error("timeDisambiguation")} errorId={errorId("timeDisambiguation")} />
          ) : null}
          <TimeZoneSelect
            id={fieldId("timeZone")}
            label={<>Time zone <span className="muted">if not the trip&apos;s</span></>}
            hint="Only for an event that happens somewhere else, such as a call at home."
            empty={`Trip zone (${zoneLabel(tripZone)})`}
            value={v.zone}
            onChange={(zone) => onChange({ zone, choice: "" })}
            place={null}
            currentZone={currentZone}
            fromPlace={false}
            error={error("timeZone")}
            errorId={errorId("timeZone")}
          />
          <Field label={<>Duration in minutes <span className="muted">optional</span></>} htmlFor={fieldId("durationMinutes")} {...fe("durationMinutes")}>
            <input id={fieldId("durationMinutes")} type="number" min={1} max={20160} value={v.duration} onChange={(e) => onChange({ duration: e.target.value })} {...aria("durationMinutes")} />
          </Field>
        </>
      ) : null}
    </FieldGrid>
  );
}
