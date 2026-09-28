import { Field, fieldStyles } from "@/components/ui/Field/Field";
import { TimeZoneSelect } from "@/features/trips/TripForm/TimeZoneSelect/TimeZoneSelect";
import { cx } from "@/lib/cx";
import type { Choice, Endpoint } from "../item-form-types";
import styles from "./FlightFields.module.css";

type Props = {
  side: "dep" | "arr";
  label: string;
  value: Endpoint;
  onChange: (patch: Partial<Endpoint>) => void;
  /** Server error for a field path such as "departure.airportCode". */
  error: (path: string) => string | undefined;
  errorId: (path: string) => string;
  /** Show the "which of the repeated times" question. */
  showChoice: boolean;
};

/** One end of a flight segment (FLIGHT-2): airport code, local date and time there, and its time zone. */
export function FlightFields({ side, label, value, onChange, error, errorId, showChoice }: Props) {
  const path = side === "dep" ? "departure" : "arrival";
  const aria = (p: string) => (error(p) ? { "aria-invalid": true as const, "aria-describedby": errorId(p) } : {});
  const f = (p: string) => ({ error: error(p), errorId: errorId(p) });
  return (
    <fieldset className={cx(fieldStyles.grid, fieldStyles.wide, styles.set)}>
      <legend className={cx("mono muted", styles.legend)}>{label}</legend>
      <Field label="Airport code" htmlFor={`item-${side}-code`} {...f(`${path}.airportCode`)}>
        <input id={`item-${side}-code`} className={styles.code} value={value.code} maxLength={4} placeholder={side === "dep" ? "SFO" : "HND"} onChange={(x) => onChange({ code: x.target.value.toUpperCase() })} {...aria(`${path}.airportCode`)} />
      </Field>
      <Field label={<>Local date and time <span className="muted">at that airport</span></>} htmlFor={`item-${side}-dt`} {...f(`${path}.localDateTime`)}>
        <input id={`item-${side}-dt`} type="datetime-local" value={value.dt} onChange={(x) => onChange({ dt: x.target.value })} {...aria(`${path}.localDateTime`)} />
      </Field>
      <TimeZoneSelect
        id={`item-${side}-zone`}
        label="Airport time zone"
        hint="The zone where this airport is."
        empty="Choose the airport's zone"
        value={value.zone}
        onChange={(zone) => onChange({ zone })}
        place={null}
        currentZone={null}
        fromPlace={false}
        error={error(`${path}.timeZone`)}
        errorId={errorId(`${path}.timeZone`)}
      />
      {showChoice ? (
        <Field label="This time happens twice that day (clocks go back). Which one?" htmlFor={`item-${side}-choice`} wide {...f(`${path}.timeDisambiguation`)}>
          <select id={`item-${side}-choice`} value={value.choice} onChange={(x) => onChange({ choice: x.target.value as Choice })} {...aria(`${path}.timeDisambiguation`)}>
            <option value="">Choose one</option>
            <option value="earlier">The earlier one</option>
            <option value="later">The later one</option>
          </select>
        </Field>
      ) : null}
    </fieldset>
  );
}
