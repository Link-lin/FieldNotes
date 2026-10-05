"use client";

import { useEffect, useState } from "react";
import type { FieldError, ItemType, PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { Field, FieldGrid, FormError } from "@/components/ui/Field/Field";
import { SectionFrame } from "@/components/ui/EditSection/EditSection";
import { api } from "@/lib/api";
import { fmtDay, TYPE_LABEL } from "@/lib/format";
import { sameValue } from "@/shared/fields";
import { dayTag } from "../../trip-days";
import {
  bookingDraftOf, bookingFields, bookingForType, errorId, fieldId, flightDraftOf, flightFields, placeDraftOf, placeFields, priceDraftOf, priceFields, whenDraftOf, whenFields,
  type BookingDraft, type FlightDraft, type PlaceDraft, type PriceDraft, type WhenDraft,
} from "../event-edit";
import { BookingFields } from "../BookingFields/BookingFields";
import { FlightFields } from "../FlightFields/FlightFields";
import { PlaceFields } from "../PlaceFields/PlaceFields";
import { PriceFields } from "../PriceFields/PriceFields";
import { WhenFields } from "../WhenFields/WhenFields";
import styles from "./NewEvent.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  /** The day in view, or empty from Whole trip. */
  defaultDate: string;
  defaultCurrency: string;
  recentCurrencies: string[];
  placeLookup: boolean;
  formId: string;
  onCreated: (item: PlanItemDTO) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
};

type Draft = { title: string; type: ItemType; when: WhenDraft; flight: FlightDraft; place: PlaceDraft; booking: BookingDraft; price: PriceDraft; notes: string };

/**
 * Add to itinerary (TRIP-9) in the event view's own layout: the title, then Details, When (or Flight), Place & map and
 * Notes, all open, saved together by the panel's Add to itinerary button. The server repeats every check; its errors
 * sit by their fields and the first one takes focus.
 */
export function NewEvent({ trip, defaultDate, defaultCurrency, recentCurrencies, placeLookup, formId, onCreated, onDirty, onBusy }: Props) {
  const [initial] = useState<Draft>(() => ({
    title: "",
    type: "activity",
    when: whenDraftOf(null, defaultDate),
    flight: flightDraftOf(null, defaultDate),
    place: placeDraftOf(null),
    booking: bookingDraftOf(null, "activity"),
    price: priceDraftOf(null, defaultCurrency),
    notes: "",
  }));
  const [v, setV] = useState<Draft>(initial);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = !sameValue(v, initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const isFlight = v.type === "flight";
  const error = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;
  const up = (patch: Partial<Draft>) => setV((o) => ({ ...o, ...patch }));
  const day = isFlight ? (v.flight.dep.dt ? v.flight.dep.dt.slice(0, 10) : v.flight.plannedDate) : v.when.noDate ? "" : v.when.date;

  function fail(fields: FieldError[], msg: string | null) {
    setErrors(fields);
    setMessage(msg);
    const first = fields[0]?.path;
    requestAnimationFrame(() => (first ? document.getElementById(fieldId(first)) ?? document.getElementById("ev-new-error") : document.getElementById("ev-new-error"))?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFlight && !v.when.noDate && !v.when.date) return fail([{ path: "localDate", code: "required", message: "Choose a date, or tick No date yet." }], null);
    const common = { title: v.title, ...placeFields(v.place), notes: v.notes.trim() || null, links: [], ...bookingFields(v.booking), ...priceFields(v.price) };
    const body = isFlight ? { ...common, type: v.type, ...flightFields(v.flight) } : { ...common, type: v.type, ...whenFields(v.when) };
    onBusy(true);
    setMessage(null);
    const r = await api<PlanItemDTO>("POST", `/api/trips/${trip.id}/items`, body);
    onBusy(false);
    if (r.ok) return onCreated(r.data);
    fail(r.fields, r.message);
  }

  const flightReady = [v.flight.dep, v.flight.arr].every((x) => /^[A-Z0-9]{3,4}$/.test(x.code) && !!x.dt && !!x.zone);
  return (
    <form id={formId} className={styles.form} onSubmit={submit} noValidate>
      <header className={styles.head}>
        <p className={styles.eyebrow}>New event{day ? ` · ${dayTag(trip, day)} · ${fmtDay(day)}` : ""}</p>
        <Field label="Event title" htmlFor={fieldId("title")} className={styles.title} error={error("title")} errorId={errorId("title")}>
          <textarea id={fieldId("title")} rows={1} value={v.title} maxLength={200} placeholder="Dinner at Gion Karyu" onChange={(e) => up({ title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} aria-invalid={error("title") ? true : undefined} aria-describedby={error("title") ? errorId("title") : undefined} />
        </Field>
      </header>

      <SectionFrame title="Details">
        <FieldGrid>
          <Field label="Type" htmlFor={fieldId("type")}>
            <select
              id={fieldId("type")}
              value={v.type}
              onChange={(e) => {
                const type = e.target.value as ItemType;
                // A flight either needs booking or is booked, and is booked only once its airports and times are in (FLIGHT-2).
                up({ type, booking: { ...v.booking, status: bookingForType(v.booking.status, type === "flight", flightReady) } });
              }}
            >
              {(Object.keys(TYPE_LABEL) as ItemType[]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
            </select>
          </Field>
        </FieldGrid>
        <BookingFields value={v.booking} onChange={(patch) => up({ booking: { ...v.booking, ...patch } })} error={error} isFlight={isFlight} flightReady={flightReady} />
        <PriceFields value={v.price} onChange={(patch) => up({ price: { ...v.price, ...patch } })} error={error} recentCurrencies={recentCurrencies} />
      </SectionFrame>

      {isFlight ? (
        <SectionFrame title="Flight">
          <FlightFields value={v.flight} onChange={(patch) => up({ flight: { ...v.flight, ...patch } })} error={error} bookedNote={v.booking.status === "booked"} />
        </SectionFrame>
      ) : (
        <SectionFrame title="When">
          <WhenFields value={v.when} onChange={(patch) => up({ when: { ...v.when, ...patch } })} tripZone={trip.timeZone} tripDates={trip} currentZone={null} error={error} />
        </SectionFrame>
      )}

      <SectionFrame title="Place & map">
        <PlaceFields value={v.place} onChange={(patch) => up({ place: { ...v.place, ...patch } })} error={error} placeLookup={placeLookup} isFlight={isFlight} tripDestination={trip.destination} links={[]} autoPin={null} />
      </SectionFrame>

      <SectionFrame title="Notes">
        <Field label={<>Notes <span className="muted">optional</span></>} htmlFor={fieldId("notes")} error={error("notes")} errorId={errorId("notes")}>
          <textarea id={fieldId("notes")} maxLength={5000} value={v.notes} placeholder="Opening hours, what to bring, who's meeting where…" onChange={(e) => up({ notes: e.target.value })} />
        </Field>
      </SectionFrame>

      {message ? <FormError id="ev-new-error">{message}</FormError> : null}
    </form>
  );
}
