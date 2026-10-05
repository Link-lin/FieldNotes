import { Field, FieldGrid, fieldStyles } from "@/components/ui/Field/Field";
import { TimeZoneSelect } from "@/features/trips/TripDetails/TimeZoneSelect/TimeZoneSelect";
import { cx } from "@/lib/cx";
import { errorId, fieldId, type Endpoint, type FlightDraft } from "../event-edit";
import { ChoiceField } from "../ChoiceField/ChoiceField";
import styles from "./FlightFields.module.css";

type Props = {
  value: FlightDraft;
  onChange: (patch: Partial<FlightDraft>) => void;
  error: (path: string) => string | undefined;
  /** Shown when the flight is (or is about to be) Booked, which needs both ends complete (FLIGHT-2). */
  bookedNote?: boolean;
};

/** A flight segment (FLIGHT-1, FLIGHT-2): carrier, a planned date until the exact time is known, and both airports. */
export function FlightFields({ value: v, onChange, error, bookedNote = false }: Props) {
  const aria = (path: string) => (error(path) ? { "aria-invalid": true as const, "aria-describedby": errorId(path) } : {});
  const fe = (path: string) => ({ error: error(path), errorId: errorId(path) });
  return (
    <FieldGrid>
      <Field label={<>Airline <span className="muted">optional</span></>} htmlFor={fieldId("airline")} {...fe("airline")}>
        <input id={fieldId("airline")} value={v.airline} maxLength={120} onChange={(e) => onChange({ airline: e.target.value })} {...aria("airline")} />
      </Field>
      <Field label={<>Flight number <span className="muted">optional</span></>} htmlFor={fieldId("flightNumber")} {...fe("flightNumber")}>
        <input id={fieldId("flightNumber")} value={v.flightNumber} maxLength={24} onChange={(e) => onChange({ flightNumber: e.target.value })} {...aria("flightNumber")} />
      </Field>
      {!v.dep.dt ? (
        <Field label={<>Planned departure date <span className="muted">if you don&apos;t know the exact time yet</span></>} htmlFor={fieldId("plannedDepartureDate")} wide {...fe("plannedDepartureDate")}>
          <input id={fieldId("plannedDepartureDate")} type="date" value={v.plannedDate} onChange={(e) => onChange({ plannedDate: e.target.value })} {...aria("plannedDepartureDate")} />
        </Field>
      ) : null}
      <FlightEnd side="departure" label="Departure" value={v.dep} onChange={(patch) => onChange({ dep: { ...v.dep, ...patch } })} error={error} />
      <FlightEnd side="arrival" label="Arrival" value={v.arr} onChange={(patch) => onChange({ arr: { ...v.arr, ...patch } })} error={error} />
      {bookedNote ? <p className={cx("note", fieldStyles.wide)}>A booked flight needs both airports, local times and time zones.</p> : null}
    </FieldGrid>
  );
}

/** One end of a flight segment: airport code, local date and time there, and its time zone. */
function FlightEnd({ side, label, value, onChange, error }: { side: "departure" | "arrival"; label: string; value: Endpoint; onChange: (patch: Partial<Endpoint>) => void; error: (path: string) => string | undefined }) {
  const p = (key: string) => `${side}.${key}`;
  const aria = (path: string) => (error(path) ? { "aria-invalid": true as const, "aria-describedby": errorId(path) } : {});
  const fe = (path: string) => ({ error: error(path), errorId: errorId(path) });
  return (
    <fieldset className={cx(fieldStyles.grid, fieldStyles.wide, styles.set)}>
      <legend className={cx("mono muted", styles.legend)}>{label}</legend>
      <Field label="Airport code" htmlFor={fieldId(p("airportCode"))} {...fe(p("airportCode"))}>
        <input id={fieldId(p("airportCode"))} className={styles.code} value={value.code} maxLength={4} placeholder={side === "departure" ? "SFO" : "HND"} onChange={(x) => onChange({ code: x.target.value.toUpperCase() })} {...aria(p("airportCode"))} />
      </Field>
      <Field label={<>Local date and time <span className="muted">at that airport</span></>} htmlFor={fieldId(p("localDateTime"))} {...fe(p("localDateTime"))}>
        <input id={fieldId(p("localDateTime"))} type="datetime-local" value={value.dt} onChange={(x) => onChange({ dt: x.target.value, choice: "" })} {...aria(p("localDateTime"))} />
      </Field>
      <TimeZoneSelect
        id={fieldId(p("timeZone"))}
        label="Airport time zone"
        hint="The zone where this airport is."
        empty="Choose the airport's zone"
        value={value.zone}
        onChange={(zone) => onChange({ zone, choice: "" })}
        place={null}
        currentZone={null}
        fromPlace={false}
        error={error(p("timeZone"))}
        errorId={errorId(p("timeZone"))}
      />
      {value.choice || error(p("timeDisambiguation")) ? (
        <ChoiceField id={fieldId(p("timeDisambiguation"))} value={value.choice} onChange={(choice) => onChange({ choice })} error={error(p("timeDisambiguation"))} errorId={errorId(p("timeDisambiguation"))} />
      ) : null}
    </fieldset>
  );
}
