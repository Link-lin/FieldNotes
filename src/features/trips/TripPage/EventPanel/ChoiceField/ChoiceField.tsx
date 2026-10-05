import { Field } from "@/components/ui/Field/Field";
import type { Choice } from "../event-edit";

/** TIME-2: a local time that happens twice (clocks go back) needs the earlier or the later one. */
export function ChoiceField({ id, value, onChange, error, errorId }: { id: string; value: Choice; onChange: (c: Choice) => void; error?: string; errorId: string }) {
  return (
    <Field label="This time happens twice that day (clocks go back). Which one?" htmlFor={id} wide error={error} errorId={errorId}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Choice)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        <option value="">Choose one</option>
        <option value="earlier">The earlier one</option>
        <option value="later">The later one</option>
      </select>
    </Field>
  );
}
