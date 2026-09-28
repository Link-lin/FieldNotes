"use client";

import { useMemo, useState } from "react";
import type { FieldError, ItemType, PlanItemDTO } from "@/shared/dto";
import { coordinatesFromMapUrl, parseCoordinateText, providerLabel } from "@/shared/map-links";
import { Button } from "@/components/ui/Button/Button";
import { CheckField, Field, FieldGrid, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { api } from "@/lib/api";
import { TYPE_LABEL } from "@/lib/format";
import { FlightFields } from "./FlightFields/FlightFields";
import { allZoneIds, type Choice, type Endpoint } from "./item-form-types";
import styles from "./ItemForm.module.css";

type Props = {
  tripId: string;
  tripTitle: string;
  tripZone: string;
  defaultCurrency: string;
  recentCurrencies?: string[];
  defaultDate: string;
  item: PlanItemDTO | null;
  triggerSelector: string | null;
  onClose: () => void;
  onSaved: (item: PlanItemDTO, created: boolean) => void;
};

/** Add to itinerary / Edit event (TRIP-9). The server repeats every check. */
export function ItemForm({ tripId, tripTitle, tripZone, defaultCurrency, recentCurrencies = [], defaultDate, item, triggerSelector, onClose, onSaved }: Props) {
  const zoneList = useMemo(() => allZoneIds(), []);
  const f = item?.flightDetails;
  const ep = (e?: { airportCode: string | null; localDateTime: string | null; timeZone: string | null; timeDisambiguation: "earlier" | "later" | null }): Endpoint => ({
    code: e?.airportCode ?? "",
    dt: e?.localDateTime ?? "",
    zone: e?.timeZone ?? "",
    choice: e?.timeDisambiguation ?? "",
  });
  const [v, setV] = useState({
    type: (item?.type ?? "activity") as ItemType,
    title: item?.title ?? "",
    noDate: item ? !item.localDate && item.type !== "flight" : false,
    date: item?.localDate ?? (item ? "" : defaultDate),
    time: item?.localTime ?? "",
    zone: item?.timeZone ?? "",
    choice: (item?.timeDisambiguation ?? "") as Choice,
    duration: item?.durationMinutes ? String(item.durationMinutes) : "",
    booking: item?.bookingStatus ?? "not_required",
    due: item?.bookingDueDate ?? "",
    amount: item?.plannedPrice?.amount ?? "",
    currency: item?.plannedPrice?.currency ?? defaultCurrency,
    label: item?.plannedPrice?.label ?? "estimate",
    location: item?.location ?? "",
    mapUrl: item?.mapUrl ?? "",
    notes: item?.notes ?? "",
    links: item?.links ?? [],
    plannedDate: f?.plannedDepartureDate ?? (item ? "" : defaultDate),
    airline: f?.airline ?? "",
    flightNumber: f?.flightNumber ?? "",
    dep: ep(f?.departure),
    arr: ep(f?.arrival),
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [needTypeConfirm, setNeedTypeConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmPrice, setConfirmPrice] = useState(false);
  const up = (patch: Partial<typeof v>) => setV((o) => ({ ...o, ...patch }));
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  const errId = (path: string) => `item-err-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const aria = (path: string) => (err(path) ? { "aria-invalid": true as const, "aria-describedby": errId(path) } : {});
  const fe = (path: string) => ({ error: err(path), errorId: errId(path) });
  const isFlight = v.type === "flight";
  const showChoice = (path: string, current: Choice) => current !== "" || errors.some((e) => e.path === path);

  function payload() {
    const common = {
      title: v.title,
      location: v.location || null,
      notes: v.notes || null,
      links: v.links,
      mapUrl: v.mapUrl.trim() || null,
      bookingStatus: v.booking,
      bookingDueDate: v.booking === "needs_booking" && v.due ? v.due : null,
      plannedPrice: v.amount.trim() ? { amount: v.amount.trim(), currency: v.currency, label: v.label } : null,
    };
    if (isFlight) {
      const e = (x: Endpoint) => ({ airportCode: x.code.trim() || null, localDateTime: x.dt || null, timeZone: x.zone || null, timeDisambiguation: x.choice || null });
      return { ...common, type: "flight", plannedDepartureDate: v.dep.dt ? null : v.plannedDate || null, airline: v.airline || null, flightNumber: v.flightNumber || null, departure: e(v.dep), arrival: e(v.arr) };
    }
    return {
      ...common,
      type: v.type,
      localDate: v.noDate ? null : v.date || null,
      localTime: v.noDate || !v.date ? null : v.time || null,
      timeZone: v.zone || null,
      timeDisambiguation: v.time && v.choice ? v.choice : null,
      durationMinutes: v.duration ? Number(v.duration) : null,
    };
  }

  async function submit(e: React.FormEvent, confirmTypeChange = false) {
    e.preventDefault();
    if (!isFlight && !v.noDate && !v.date) {
      setErrors([{ path: "localDate", code: "required", message: "Choose a date, or tick No date yet." }]);
      requestAnimationFrame(() => document.getElementById("item-localDate")?.focus());
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = item
      ? await api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${item.id}`, { item: payload(), expectedVersion: item.version, ...(confirmTypeChange ? { confirmTypeChange: true } : {}), ...(confirmPrice ? { confirmPrice: true } : {}) })
      : await api<PlanItemDTO>("POST", `/api/trips/${tripId}/items`, payload());
    setBusy(false);
    if (r.ok) {
      onSaved(r.data, !item);
      return;
    }
    if (r.code === "type_change_confirmation_required") {
      setNeedTypeConfirm(true);
      setMessage(r.message);
      return;
    }
    setErrors(r.fields);
    setMessage(r.message);
    const first = r.fields[0]?.path;
    const idFor: Record<string, string> = {
      localTime: "item-time", localDate: "item-localDate", timeDisambiguation: "item-choice", title: "item-title", mapUrl: "item-map",
      "plannedPrice.amount": "item-amount", "departure.localDateTime": "item-dep-dt", "arrival.localDateTime": "item-arr-dt",
      "departure.airportCode": "item-dep-code", "arrival.airportCode": "item-arr-code", "departure.timeZone": "item-dep-zone", "arrival.timeZone": "item-arr-zone",
      "departure.timeDisambiguation": "item-dep-choice", "arrival.timeDisambiguation": "item-arr-choice", bookingDueDate: "item-due",
    };
    requestAnimationFrame(() => document.getElementById((first && idFor[first]) || "item-form-error")?.focus());
  }

  // FLIGHT-2: "Booked" needs both airport codes, local date-times and time zones.
  const flightReady = [v.dep, v.arr].every((e) => /^[A-Z0-9]{3,4}$/.test(e.code) && !!e.dt && !!e.zone);
  // MAP-2: say before saving whether the map field will pin the stop (the server decides on save).
  const mapText = v.mapUrl.trim();
  const pin = mapText ? (parseCoordinateText(mapText) ?? coordinatesFromMapUrl(mapText)) : null;
  const mapHint = !mapText
    ? "Paste a Google Maps, Apple Maps or OpenStreetMap link, or coordinates like 35.0116, 135.7681. In Google Maps, right-click the place and click the numbers at the top of the menu to copy them."
    : pin
      ? `Pins the stop at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}.`
      : "This link has no coordinates the app can read, so the event won't be on the day map. Pasting coordinates works too.";
  const importedLinks = v.links.filter((l) => providerLabel(l.url) && l.url.startsWith("https://") && l.url !== v.mapUrl);
  const choiceField = (id: string, value: Choice, onChange: (c: Choice) => void, path: string) => (
    <Field label="This time happens twice that day (clocks go back). Which one?" htmlFor={id} wide {...fe(path)}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Choice)} {...aria(path)}>
        <option value="">Choose one</option>
        <option value="earlier">The earlier one</option>
        <option value="later">The later one</option>
      </select>
    </Field>
  );
  const optional = (words = "optional") => <span className="muted">{words}</span>;

  return (
    <Modal
      title={item ? "Edit event" : "Add to itinerary"}
      onClose={onClose}
      triggerSelector={triggerSelector}
      subtitle={<>{tripTitle}. A map link with coordinates, or coordinates on their own, puts the event on the day map.</>}
    >
      <form className={styles.form} onSubmit={(e) => submit(e)} noValidate>
        <FieldGrid>
          <Field label="What is it?" htmlFor="item-title" wide {...fe("title")}>
            <input id="item-title" value={v.title} maxLength={200} placeholder="Dinner at Gion Karyu" onChange={(e) => up({ title: e.target.value })} {...aria("title")} />
          </Field>
          <Field label="Type" htmlFor="item-type">
            <select
              id="item-type"
              value={v.type}
              onChange={(e) => {
                const type = e.target.value as ItemType;
                up({ type, booking: type === "flight" && v.booking === "not_required" ? "needs_booking" : v.booking });
                setNeedTypeConfirm(false);
              }}
            >
              {(Object.keys(TYPE_LABEL) as ItemType[]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Booking" htmlFor="item-booking" {...fe("bookingStatus")}>
            <select id="item-booking" value={v.booking} onChange={(e) => up({ booking: e.target.value as typeof v.booking })} {...aria("bookingStatus")}>
              {!isFlight ? <option value="not_required">Nothing to book</option> : null}
              <option value="needs_booking">Needs booking</option>
              <option value="booked" disabled={isFlight && !flightReady && v.booking !== "booked"}>
                {isFlight && !flightReady ? "Booked (add both airports and times first)" : "Booked"}
              </option>
            </select>
          </Field>
          {v.booking === "needs_booking" ? (
            <Field label={<>Book by {optional()}</>} htmlFor="item-due" {...fe("bookingDueDate")}>
              <input id="item-due" type="date" value={v.due} onChange={(e) => up({ due: e.target.value })} {...aria("bookingDueDate")} />
            </Field>
          ) : null}

          {isFlight ? (
            <>
              <Field label={<>Airline {optional()}</>} htmlFor="item-airline">
                <input id="item-airline" value={v.airline} maxLength={120} onChange={(e) => up({ airline: e.target.value })} />
              </Field>
              <Field label={<>Flight number {optional()}</>} htmlFor="item-flightno">
                <input id="item-flightno" value={v.flightNumber} maxLength={24} onChange={(e) => up({ flightNumber: e.target.value })} />
              </Field>
              {!v.dep.dt ? (
                <Field label={<>Planned departure date {optional("if you don't know the exact time yet")}</>} htmlFor="item-planned" wide {...fe("plannedDepartureDate")}>
                  <input id="item-planned" type="date" value={v.plannedDate} onChange={(e) => up({ plannedDate: e.target.value })} {...aria("plannedDepartureDate")} />
                </Field>
              ) : null}
              {(["dep", "arr"] as const).map((side) => (
                <FlightFields
                  key={side}
                  side={side}
                  label={side === "dep" ? "Departure" : "Arrival"}
                  value={v[side]}
                  onChange={(patch) => up({ [side]: { ...v[side], ...patch } } as Partial<typeof v>)}
                  zones={zoneList}
                  error={err}
                  errorId={errId}
                  showChoice={showChoice(`${side === "dep" ? "departure" : "arrival"}.timeDisambiguation`, v[side].choice)}
                />
              ))}
              {v.booking === "booked" ? <p className={`note ${styles.wide}`}>A booked flight needs both airports, local times and time zones.</p> : null}
            </>
          ) : (
            <>
              <CheckField className={styles.wide} label="No date yet (shown under Undated)" checked={v.noDate} onChange={(e) => up({ noDate: e.target.checked })} />
              {!v.noDate ? (
                <>
                  <Field label="Date" htmlFor="item-localDate" {...fe("localDate")}>
                    <input id="item-localDate" type="date" value={v.date} onChange={(e) => up({ date: e.target.value })} {...aria("localDate")} />
                  </Field>
                  <Field label={<>Time {optional()}</>} htmlFor="item-time" {...fe("localTime")}>
                    <input id="item-time" type="time" value={v.time} onChange={(e) => up({ time: e.target.value })} {...aria("localTime")} />
                  </Field>
                  {showChoice("timeDisambiguation", v.choice) ? choiceField("item-choice", v.choice, (c) => up({ choice: c }), "timeDisambiguation") : null}
                  <Field label={<>Time zone {optional("if not the trip's")}</>} htmlFor="item-zone">
                    <select id="item-zone" value={v.zone} onChange={(e) => up({ zone: e.target.value })} {...aria("timeZone")}>
                      <option value="">Trip zone ({tripZone})</option>
                      {zoneList.map((z) => <option key={z}>{z}</option>)}
                    </select>
                  </Field>
                  <Field label={<>Duration in minutes {optional()}</>} htmlFor="item-duration" {...fe("durationMinutes")}>
                    <input id="item-duration" type="number" min={1} max={20160} value={v.duration} onChange={(e) => up({ duration: e.target.value })} {...aria("durationMinutes")} />
                  </Field>
                </>
              ) : null}
            </>
          )}

          <Field label={<>Planned price {optional()}</>} htmlFor="item-amount" wide {...fe("plannedPrice.amount")}>
            <MoneyInput
              amountId="item-amount"
              currencyId="item-currency"
              amount={v.amount}
              currency={v.currency}
              onAmount={(a) => up({ amount: a })}
              onCurrency={(c) => up({ currency: c })}
              recent={recentCurrencies}
              currencyLabel="Price currency"
              placeholder="120"
              invalid={!!err("plannedPrice.amount")}
              describedBy={err("plannedPrice.amount") ? errId("plannedPrice.amount") : undefined}
            />
          </Field>
          <Field label="The price is a" htmlFor="item-label" wide>
            <select id="item-label" value={v.label} onChange={(e) => up({ label: e.target.value as "estimate" | "quote" })}>
              <option value="estimate">Estimate</option>
              <option value="quote">Quote</option>
            </select>
          </Field>
          {item?.plannedPrice?.source === "ai" && v.amount.trim() ? (
            <CheckField
              className={styles.wide}
              label="I checked this price; mark it as my estimate or quote"
              checked={confirmPrice}
              onChange={(e) => setConfirmPrice(e.target.checked)}
            />
          ) : null}
          <Field label={<>Place {optional()}</>} htmlFor="item-location" wide>
            <input id="item-location" value={v.location} maxLength={500} placeholder="Fushimi Inari Taisha, Kyoto" onChange={(e) => up({ location: e.target.value })} />
          </Field>
          <Field label={<>Map link or coordinates {optional()}</>} htmlFor="item-map" wide hint={mapHint} hintId="item-map-hint" {...fe("mapUrl")}>
            <input
              id="item-map"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={v.mapUrl}
              placeholder="https://www.google.com/maps/… or 35.0116, 135.7681"
              onChange={(e) => up({ mapUrl: e.target.value })}
              aria-describedby="item-map-hint"
              {...aria("mapUrl")}
            />
          </Field>
          {importedLinks.length ? (
            <div className={styles.wide}>
              <span className="muted">Links on this event:</span>
              <div className={`cluster ${styles.linkButtons}`}>
                {importedLinks.map((l, i) => (
                  <Button key={i} variant="quiet" onClick={() => up({ mapUrl: l.url })}>
                    Use {providerLabel(l.url)} link as map link
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <Field label={<>Notes {optional()}</>} htmlFor="item-notes" wide>
            <textarea id="item-notes" maxLength={5000} value={v.notes} onChange={(e) => up({ notes: e.target.value })} />
          </Field>
        </FieldGrid>
        {message ? <FormError id="item-form-error">{message}</FormError> : null}
        <ModalActions>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          {needTypeConfirm ? (
            <Button variant="dangerFill" disabled={busy} onClick={(e) => submit(e, true)}>Change type and clear times</Button>
          ) : (
            <Button variant="fill" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add to itinerary"}</Button>
          )}
        </ModalActions>
      </form>
    </Modal>
  );
}
