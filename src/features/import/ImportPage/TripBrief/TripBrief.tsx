"use client";

import { useState } from "react";
import type { PlaceDTO } from "@/shared/dto";
import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { DestinationInput } from "@/features/trips/TripForm/DestinationInput/DestinationInput";
import { TimeZoneSelect } from "@/features/trips/TripForm/TimeZoneSelect/TimeZoneSelect";
import type { TripBrief as Brief } from "../../import-prompt";
import styles from "./TripBrief.module.css";

type Props = { value: Brief; onChange: (patch: Partial<Brief>) => void; errors: Record<string, string> };

function suggestedTitle(destination: string, date: string): string {
  const place = destination.trim();
  if (!place) return "";
  return `${place}${date ? ` · ${date.slice(0, 7)}` : " trip"}`.slice(0, 120);
}

/** Owner-supplied prompt details; none of these fields are saved until import confirmation. */
export function TripBrief({ value, onChange, errors }: Props) {
  const [place, setPlace] = useState<PlaceDTO | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [zoneTouched, setZoneTouched] = useState(false);
  const aria = (key: string) => errors[key] ? { "aria-invalid": true as const, "aria-describedby": `brief-${key}-err` } : {};

  return (
    <FieldGrid className={styles.fields}>
      <Field label="Trip name" htmlFor="brief-title" wide error={errors.title} errorId="brief-title-err">
        <input id="brief-title" value={value.title} maxLength={120} placeholder="Kyoto in autumn" onChange={(e) => { setTitleTouched(true); onChange({ title: e.target.value }); }} {...aria("title")} />
      </Field>
      <Field label="Main destination" htmlFor="brief-destination" wide error={errors.destination} errorId="brief-destination-err" hint="Pick a place to suggest its time zone, or type a multi-stop destination." hintId="brief-destination-hint">
        <DestinationInput
          id="brief-destination"
          value={value.destination}
          onChange={(destination) => {
            onChange({ destination, ...(!titleTouched ? { title: suggestedTitle(destination, value.startDate) } : {}) });
            if (place && destination !== place.label) setPlace(null);
          }}
          onPick={(picked) => {
            setPlace(picked);
            if (!zoneTouched && picked.timeZones[0]) onChange({ timeZone: picked.timeZones[0] });
          }}
          invalid={!!errors.destination}
          describedBy={errors.destination ? "brief-destination-err" : "brief-destination-hint"}
        />
      </Field>
      <Field label="Start date" htmlFor="brief-startDate" error={errors.startDate} errorId="brief-startDate-err">
        <input id="brief-startDate" type="date" value={value.startDate} onChange={(e) => {
          const startDate = e.target.value;
          onChange({ startDate, endDate: startDate && (!value.endDate || value.endDate < startDate) ? startDate : value.endDate,
            ...(!titleTouched ? { title: suggestedTitle(value.destination, startDate) } : {}) });
        }} {...aria("startDate")} />
      </Field>
      <Field label="End date" htmlFor="brief-endDate" error={errors.endDate} errorId="brief-endDate-err">
        <input id="brief-endDate" type="date" value={value.endDate} min={value.startDate || undefined} onChange={(e) => onChange({ endDate: e.target.value })} {...aria("endDate")} />
      </Field>
      <TimeZoneSelect id="brief-timeZone" value={value.timeZone} onChange={(timeZone) => { setZoneTouched(true); onChange({ timeZone }); }} place={place} currentZone={null} fromPlace={!zoneTouched} error={errors.timeZone} />
      <Field label={<>Budget <span className="muted">optional</span></>} htmlFor="brief-budget" wide error={errors.budget} errorId="brief-budget-err">
        <MoneyInput amountId="brief-budget" currencyId="brief-currency" amount={value.budgetAmount} currency={value.budgetCurrency} onAmount={(budgetAmount) => onChange({ budgetAmount })} onCurrency={(budgetCurrency) => onChange({ budgetCurrency })} recent={[]} currencyLabel="Budget currency" placeholder="1200" invalid={!!errors.budget} describedBy={errors.budget ? "brief-budget-err" : undefined} />
      </Field>
      <Field label={<>Interests <span className="muted">optional</span></>} htmlFor="brief-interests" wide>
        <textarea id="brief-interests" value={value.interests} onChange={(e) => onChange({ interests: e.target.value })} placeholder="Art, food, hiking…" rows={2} />
      </Field>
      <Field label={<>Pace <span className="muted">optional</span></>} htmlFor="brief-pace">
        <select id="brief-pace" value={value.pace} onChange={(e) => onChange({ pace: e.target.value })}>
          <option value="">No preference</option>
          <option value="Relaxed">Relaxed</option>
          <option value="Balanced">Balanced</option>
          <option value="Full days">Full days</option>
        </select>
      </Field>
      <Field label={<>Constraints <span className="muted">optional</span></>} htmlFor="brief-constraints" wide>
        <textarea id="brief-constraints" value={value.constraints} onChange={(e) => onChange({ constraints: e.target.value })} placeholder="Accessibility, dietary needs, fixed bookings, arrival time…" rows={3} />
      </Field>
    </FieldGrid>
  );
}
