"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FieldError, PlaceDTO, TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Field, FieldGrid, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { useToast } from "@/components/ui/Toast/Toast";
import { defaultCurrency } from "@/features/currency/CurrencyOptions/CurrencyOptions";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { DeleteTripDialog } from "./DeleteTripDialog/DeleteTripDialog";
import { DestinationInput } from "./DestinationInput/DestinationInput";
import { TimeZoneSelect } from "./TimeZoneSelect/TimeZoneSelect";
import { impactBlocks, ZoneImpact, type Choice, type Impact } from "./ZoneImpact/ZoneImpact";
import styles from "./TripForm.module.css";

type Trip = TripDetailDTO["trip"];
type Props = { trip: Trip | null; onClose: () => void; itemDates?: string[]; recentCurrencies?: string[] };

/** New trip / Edit trip (DASH-3, DASH-6), including the time-zone impact check and Delete trip. */
export function TripForm({ trip, onClose, itemDates = [], recentCurrencies = [] }: Props) {
  const router = useRouter();
  const toast = useToast();
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [v, setV] = useState({
    title: trip?.title ?? "",
    destination: trip?.destination ?? "",
    startDate: trip?.startDate ?? "",
    endDate: trip?.endDate ?? "",
    timeZone: trip?.timeZone ?? browserZone,
    budgetAmount: trip?.budget?.amount ?? "",
    budgetCurrency: trip?.budget?.currency ?? defaultCurrency(recentCurrencies),
  });
  // The picked destination suggests zones; on a new trip its first zone applies until the owner picks one.
  const [place, setPlace] = useState<PlaceDTO | null>(null);
  const [zoneTouched, setZoneTouched] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [deleting, setDeleting] = useState(false);
  const update = (patch: Partial<typeof v>) => setV((o) => ({ ...o, ...patch }));
  const err = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;
  const aria = (id: string) => (err(id) ? { "aria-invalid": true as const, "aria-describedby": `tf-${id}-err` } : {});
  const outside = trip && v.startDate && v.endDate ? itemDates.filter((d) => d < v.startDate || d > v.endDate).length : 0;

  function body() {
    return {
      title: v.title,
      destination: v.destination,
      startDate: v.startDate,
      endDate: v.endDate,
      timeZone: v.timeZone,
      budget: v.budgetAmount.trim() ? { amount: v.budgetAmount.trim(), currency: v.budgetCurrency } : null,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    if (!trip) {
      const r = await api<TripSummaryDTO>("POST", "/api/trips", body());
      setBusy(false);
      if (!r.ok) return fail(r.fields, r.message);
      router.push(`/trips/${r.data.id}`);
      return;
    }
    const zoneChanged = v.timeZone !== trip.timeZone;
    if (zoneChanged && !impact) {
      const p = await api<Impact>("POST", `/api/trips/${trip.id}/time-zone-preview`, { timeZone: v.timeZone, expectedVersion: trip.version });
      setBusy(false);
      if (!p.ok) return fail(p.fields, p.message);
      setImpact(p.data);
      return;
    }
    const r = await api<TripSummaryDTO>("PATCH", `/api/trips/${trip.id}`, {
      ...body(),
      expectedVersion: trip.version,
      ...(zoneChanged ? { confirmTimeZoneImpact: true, timeDisambiguationByItem: choices } : {}),
    });
    setBusy(false);
    if (!r.ok) return fail(r.fields, r.message);
    const notes = ["Trip updated"];
    if (outside) notes.push(`${plural(outside, "event")} now ${outside === 1 ? "falls" : "fall"} outside the trip dates`);
    if (v.destination !== trip.destination && trip.atlasLocation?.source === "owner") notes.push("the destination changed, so check the globe point you set");
    toast({ message: notes.join(". ") + "." });
    onClose();
    router.refresh();
  }

  function fail(fields: FieldError[], msg: string) {
    setErrors(fields);
    setMessage(msg);
    const first = fields[0]?.path.split(".")[0];
    const id = first ? `tf-${first}` : null;
    requestAnimationFrame(() => (id ? document.getElementById(id) : document.getElementById("tf-form-error"))?.focus());
  }

  if (deleting && trip) return <DeleteTripDialog trip={trip} onCancel={() => setDeleting(false)} />;

  return (
    <Modal
      title={trip ? "Edit trip" : "New trip"}
      onClose={onClose}
      triggerSelector={trip ? "[data-edit-trip]" : null}
      subtitle={trip ? "Change the name, place, dates, time zone or budget. Your events keep their dates and times." : "Start with the basics. You can add events afterwards."}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <FieldGrid>
          <Field label="Trip name" htmlFor="tf-title" wide error={err("title")} errorId="tf-title-err">
            <input id="tf-title" value={v.title} onChange={(e) => update({ title: e.target.value })} maxLength={120} placeholder="Kyoto in autumn" {...aria("title")} />
          </Field>
          <Field
            label="Main destination"
            htmlFor="tf-destination"
            wide
            error={err("destination")}
            errorId="tf-destination-err"
            hint="Pick a suggestion to pin the trip on the globe, or type any name for a multi-stop trip."
            hintId="tf-destination-hint"
          >
            <DestinationInput
              id="tf-destination"
              value={v.destination}
              onChange={(d) => {
                update({ destination: d });
                if (place && d !== place.label) setPlace(null);
              }}
              onPick={(p) => {
                setPlace(p);
                const z = p.timeZones[0];
                if (!trip && !zoneTouched && z) update({ timeZone: z });
              }}
              invalid={!!err("destination")}
              describedBy={err("destination") ? "tf-destination-err" : "tf-destination-hint"}
            />
          </Field>
          <Field label="Start date" htmlFor="tf-startDate" error={err("startDate")} errorId="tf-startDate-err">
            <input
              id="tf-startDate"
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
          <Field label="End date" htmlFor="tf-endDate" error={err("endDate")} errorId="tf-endDate-err">
            <input id="tf-endDate" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => update({ endDate: e.target.value })} {...aria("endDate")} />
          </Field>
          <TimeZoneSelect
            id="tf-timeZone"
            value={v.timeZone}
            onChange={(z) => {
              update({ timeZone: z });
              setZoneTouched(true);
              setImpact(null);
              setChoices({});
            }}
            place={place}
            currentZone={trip?.timeZone ?? null}
            fromPlace={!trip && !zoneTouched}
            error={err("timeZone")}
          />
          <Field label={<>Budget <span className="muted">optional</span></>} htmlFor="tf-budget" wide error={err("budget")} errorId="tf-budget-err">
            <MoneyInput
              amountId="tf-budget"
              currencyId="tf-budgetCurrency"
              amount={v.budgetAmount}
              currency={v.budgetCurrency}
              onAmount={(a) => update({ budgetAmount: a })}
              onCurrency={(c) => update({ budgetCurrency: c })}
              recent={recentCurrencies}
              currencyLabel="Budget currency"
              placeholder="3500"
              invalid={!!err("budget")}
              describedBy={err("budget") ? "tf-budget-err" : undefined}
            />
          </Field>
        </FieldGrid>
        {outside ? <p className="note" role="status">{plural(outside, "event")} will fall outside these dates. They stay on the trip, marked as outside the trip dates.</p> : null}
        {impact ? <ZoneImpact impact={impact} zone={v.timeZone} choices={choices} onChoose={(id, c) => setChoices((o) => ({ ...o, [id]: c }))} /> : null}
        {message ? <FormError id="tf-form-error">{message}</FormError> : null}
        <ModalActions>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="fill" type="submit" disabled={busy || impactBlocks(impact, choices)}>
            {busy ? "Saving…" : trip ? (impact ? "Confirm and save" : "Save changes") : "Create trip"}
          </Button>
        </ModalActions>
      </form>
      {trip ? (
        <div className={styles.danger}>
          <b>Delete this trip</b>
          <p className="note">Removes the trip, its events and booking list, and revokes every invitation. This cannot be undone.</p>
          <div>
            <Button variant="danger" onClick={() => setDeleting(true)}>Delete trip…</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
