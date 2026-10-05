"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldError, PlaceDTO, TripSummaryDTO } from "@/shared/dto";
import { sameValue } from "@/shared/fields";
import { ButtonLink } from "@/components/ui/Button/Button";
import { Field, FieldGrid, FormError } from "@/components/ui/Field/Field";
import { SectionFrame } from "@/components/ui/EditSection/EditSection";
import { defaultCurrency } from "@/features/currency/CurrencyOptions/CurrencyOptions";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { api } from "@/lib/api";
import { DestinationInput } from "../DestinationInput/DestinationInput";
import { TimeZoneSelect } from "../TimeZoneSelect/TimeZoneSelect";
import styles from "./NewTrip.module.css";

type Props = { formId: string; recentCurrencies: string[]; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onCreated?: (tripId: string) => void };

/**
 * New trip (DASH-3) in the trip details' own layout: name and destination, then Dates, Time zone and Budget, all open,
 * created by the panel's Create trip button. Picking a destination suggests its time zone until one is chosen by hand.
 */
export function NewTrip({ formId, recentCurrencies, onDirty, onBusy, onCreated }: Props) {
  const router = useRouter();
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [initial] = useState(() => ({ title: "", destination: "", startDate: "", endDate: "", timeZone: browserZone, budgetAmount: "", budgetCurrency: defaultCurrency(recentCurrencies) }));
  const [v, setV] = useState(initial);
  const [place, setPlace] = useState<PlaceDTO | null>(null);
  const [zoneTouched, setZoneTouched] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = !sameValue(v, initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const up = (patch: Partial<typeof v>) => setV((o) => ({ ...o, ...patch }));
  const err = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;
  const aria = (id: string) => (err(id) ? { "aria-invalid": true as const, "aria-describedby": `nt-${id}-err` } : {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onBusy(true);
    setMessage(null);
    const r = await api<TripSummaryDTO>("POST", "/api/trips", {
      title: v.title,
      destination: v.destination,
      startDate: v.startDate,
      endDate: v.endDate,
      timeZone: v.timeZone,
      budget: v.budgetAmount.trim() ? { amount: v.budgetAmount.trim(), currency: v.budgetCurrency } : null,
    });
    if (r.ok) {
      onDirty(false);
      if (onCreated) onCreated(r.data.id);
      else router.push(`/trips/${r.data.id}`);
      return;
    }
    onBusy(false);
    setErrors(r.fields);
    setMessage(r.message);
    const first = r.fields[0]?.path.split(".")[0];
    requestAnimationFrame(() => document.getElementById(first ? `nt-${first}` : "nt-form-error")?.focus());
  }

  return (
    <form id={formId} className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.alt}>
        Planning with an AI chat already? <ButtonLink variant="link" href="/import">Start from an AI plan instead</ButtonLink>
      </p>
      <header className={styles.head}>
        <Field label="Trip name" htmlFor="nt-title" className={styles.title} error={err("title")} errorId="nt-title-err">
          <input id="nt-title" value={v.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} placeholder="Kyoto in autumn" {...aria("title")} />
        </Field>
        <Field label="Main destination" htmlFor="nt-destination" error={err("destination")} errorId="nt-destination-err" hint="Pick a suggestion to pin the trip on the globe, or type any name for a multi-stop trip." hintId="nt-destination-hint">
          <DestinationInput
            id="nt-destination"
            value={v.destination}
            onChange={(d) => {
              up({ destination: d });
              if (place && d !== place.label) setPlace(null);
            }}
            onPick={(p) => {
              setPlace(p);
              const z = p.timeZones[0];
              if (!zoneTouched && z) up({ timeZone: z });
            }}
            invalid={!!err("destination")}
            describedBy={err("destination") ? "nt-destination-err" : "nt-destination-hint"}
          />
        </Field>
      </header>

      <SectionFrame title="Dates">
        <FieldGrid>
          <Field label="Start date" htmlFor="nt-startDate" error={err("startDate")} errorId="nt-startDate-err">
            <input
              id="nt-startDate"
              type="date"
              value={v.startDate}
              onChange={(e) => {
                const start = e.target.value;
                // The end date follows the start date, so its picker opens on the right month.
                setV((o) => ({ ...o, startDate: start, endDate: start && (!o.endDate || o.endDate < start) ? start : o.endDate }));
              }}
              {...aria("startDate")}
            />
          </Field>
          <Field label="End date" htmlFor="nt-endDate" error={err("endDate")} errorId="nt-endDate-err">
            <input id="nt-endDate" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => up({ endDate: e.target.value })} {...aria("endDate")} />
          </Field>
        </FieldGrid>
      </SectionFrame>

      <SectionFrame title="Time zone">
        <TimeZoneSelect
          id="nt-timeZone"
          value={v.timeZone}
          onChange={(z) => { up({ timeZone: z }); setZoneTouched(true); }}
          place={place}
          currentZone={null}
          fromPlace={!zoneTouched}
          error={err("timeZone")}
          errorId="nt-timeZone-err"
        />
      </SectionFrame>

      <SectionFrame title="Budget">
        <Field label={<>Budget <span className="muted">optional</span></>} htmlFor="nt-budget" error={err("budget")} errorId="nt-budget-err">
          <MoneyInput
            amountId="nt-budget"
            currencyId="nt-budgetCurrency"
            amount={v.budgetAmount}
            currency={v.budgetCurrency}
            onAmount={(a) => up({ budgetAmount: a })}
            onCurrency={(c) => up({ budgetCurrency: c })}
            recent={recentCurrencies}
            currencyLabel="Budget currency"
            placeholder="3500"
            invalid={!!err("budget")}
            describedBy={err("budget") ? "nt-budget-err" : undefined}
          />
        </Field>
      </SectionFrame>

      {message ? <FormError id="nt-form-error">{message}</FormError> : null}
    </form>
  );
}
