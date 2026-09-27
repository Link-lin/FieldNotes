"use client";

import { useState } from "react";
import type { FieldError, PlaceDTO } from "@/shared/dto";
import type { ImportPreviewDTO } from "@/shared/import";
import { Button } from "@/components/ui/Button/Button";
import { Banner } from "@/components/ui/Banner/Banner";
import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { DestinationInput } from "@/features/trips/TripForm/DestinationInput/DestinationInput";
import { TimeZoneSelect } from "@/features/trips/TripForm/TimeZoneSelect/TimeZoneSelect";
import styles from "./TripPreview.module.css";

type TripValues = ImportPreviewDTO["trip"]["values"];
type Props = { values: TripValues; errors: FieldError[]; warnings: FieldError[]; busy: boolean; onChange: (path: string, value: unknown) => void };
const rec = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const text = (x: unknown): string => x == null ? "" : typeof x === "string" || typeof x === "number" ? String(x) : JSON.stringify(x);
const cleanPath = (x: string) => x.replace(/^trip\./, "");

/** Correct the imported trip itself. Its budget is always an owner-controlled value. */
export function TripPreview({ values, errors, warnings, busy, onChange }: Props) {
  const [place, setPlace] = useState<PlaceDTO | null>(null);
  const err = (path: string) => errors.find((e) => cleanPath(e.path) === path)?.message;
  const aria = (path: string) => err(path) ? { "aria-invalid": true as const, "aria-describedby": `preview-${path}-err` } : {};
  const budget = rec(values.budget);
  const budgetAmount = text(budget.amount);
  const budgetCurrency = text(budget.currency) || "USD";

  return (
    <section className={styles.wrap} aria-labelledby="preview-trip-title">
      <h2 id="preview-trip-title">Trip details</h2>
      <p className="note">Review the title, dates, destination, time zone and budget before creating the trip.</p>
      {warnings.length ? <Banner tone="warn" role="status"><ul>{warnings.map((warning, i) => <li key={i}>{warning.message}</li>)}</ul></Banner> : null}
      {errors.length ? <ul className={styles.errors}>{errors.map((error, i) => <li key={`${error.path}-${i}`}>{error.message}</li>)}</ul> : null}
      <fieldset disabled={busy} className={styles.fieldset}>
        <FieldGrid>
          <Field label="Trip name" htmlFor="preview-title" wide error={err("title")} errorId="preview-title-err">
            <input id="preview-title" value={text(values.title)} maxLength={120} onChange={(e) => onChange("title", e.target.value)} {...aria("title")} />
          </Field>
          <Field label="Main destination" htmlFor="preview-destination" wide error={err("destination")} errorId="preview-destination-err">
            <DestinationInput id="preview-destination" value={text(values.destination)} onChange={(destination) => onChange("destination", destination)} onPick={setPlace} invalid={!!err("destination")} describedBy={err("destination") ? "preview-destination-err" : undefined} />
          </Field>
          <Field label="Start date" htmlFor="preview-startDate" error={err("startDate")} errorId="preview-startDate-err">
            <input id="preview-startDate" value={text(values.startDate)} placeholder="YYYY-MM-DD" onChange={(e) => onChange("startDate", e.target.value)} {...aria("startDate")} />
          </Field>
          <Field label="End date" htmlFor="preview-endDate" error={err("endDate")} errorId="preview-endDate-err">
            <input id="preview-endDate" value={text(values.endDate)} placeholder="YYYY-MM-DD" onChange={(e) => onChange("endDate", e.target.value)} {...aria("endDate")} />
          </Field>
          <TimeZoneSelect id="preview-timeZone" value={text(values.timeZone)} onChange={(zone) => onChange("timeZone", zone)} place={place} currentZone={null} fromPlace={false} error={err("timeZone")} />
          <Field label={<>Budget <span className="muted">optional; owner controlled</span></>} htmlFor="preview-budget" wide error={err("budget") || err("budget.amount") || err("budget.currency")} errorId="preview-budget-err">
            <MoneyInput amountId="preview-budget" currencyId="preview-currency" amount={budgetAmount} currency={budgetCurrency} onAmount={(amount) => onChange("budget", amount.trim() ? { amount, currency: budgetCurrency } : null)} onCurrency={(currency) => onChange("budget", budgetAmount.trim() ? { amount: budgetAmount, currency } : null)} recent={[]} currencyLabel="Budget currency" invalid={!!err("budget")} describedBy={err("budget") ? "preview-budget-err" : undefined} />
          </Field>
        </FieldGrid>
        {values.budget != null ? <Button variant="quiet" onClick={() => onChange("budget", null)}>Remove budget</Button> : null}
      </fieldset>
    </section>
  );
}
