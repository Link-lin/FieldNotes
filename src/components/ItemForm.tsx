"use client";

import { useMemo, useState } from "react";
import type { FieldError, ItemType, PlanItemDTO } from "@/shared/dto";
import { providerLabel } from "@/shared/map-links";
import { CurrencyOptions } from "./CurrencyOptions";
import { Modal } from "@/components/ui/Modal/Modal";
import { api } from "@/lib/api";
import { TYPE_LABEL } from "@/lib/format";

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

type Choice = "" | "earlier" | "later";
type Endpoint = { code: string; dt: string; zone: string; choice: Choice };

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** Add to itinerary / Edit event (TRIP-9). The server repeats every check. */
export function ItemForm({ tripId, tripTitle, tripZone, defaultCurrency, recentCurrencies = [], defaultDate, item, triggerSelector, onClose, onSaved }: Props) {
  const zoneList = useMemo(() => zones(), []);
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
  const up = (patch: Partial<typeof v>) => setV((o) => ({ ...o, ...patch }));
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  const errId = (path: string) => `item-err-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const aria = (path: string) => (err(path) ? { "aria-invalid": true as const, "aria-describedby": errId(path) } : {});
  const errMsg = (path: string) => (err(path) ? <span className="field-error" id={errId(path)}>{err(path)}</span> : null);
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
      ? await api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${item.id}`, { item: payload(), expectedVersion: item.version, ...(confirmTypeChange ? { confirmTypeChange: true } : {}) })
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

  const zoneOptions = (id: string, value: string, onChange: (z: string) => void, emptyLabel: string, path: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...aria(path)}>
      <option value="">{emptyLabel}</option>
      {zoneList.map((z) => <option key={z}>{z}</option>)}
    </select>
  );
  const choiceSelect = (id: string, value: Choice, onChange: (c: Choice) => void, path: string) => (
    <label className="field wide" htmlFor={id}>
      This time happens twice that day (clocks go back). Which one?
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Choice)} {...aria(path)}>
        <option value="">Choose one</option>
        <option value="earlier">The earlier one</option>
        <option value="later">The later one</option>
      </select>
      {errMsg(path)}
    </label>
  );
  // FLIGHT-2: "Booked" needs both airport codes, local date-times and time zones.
  const flightReady = [v.dep, v.arr].every((e) => /^[A-Z]{3}$/.test(e.code) && !!e.dt && !!e.zone);
  const endpoint = (side: "dep" | "arr", label: string) => {
    const e = v[side];
    const path = side === "dep" ? "departure" : "arrival";
    const set = (patch: Partial<Endpoint>) => up({ [side]: { ...e, ...patch } } as Partial<typeof v>);
    return (
      <fieldset className="form-grid wide" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="mono muted" style={{ marginBottom: 6 }}>{label}</legend>
        <label className="field" htmlFor={`item-${side}-code`}>
          Airport code
          <input id={`item-${side}-code`} value={e.code} maxLength={3} placeholder={side === "dep" ? "SFO" : "HND"} style={{ textTransform: "uppercase" }} onChange={(x) => set({ code: x.target.value.toUpperCase() })} {...aria(`${path}.airportCode`)} />
          {errMsg(`${path}.airportCode`)}
        </label>
        <label className="field" htmlFor={`item-${side}-dt`}>
          Local date and time <span className="muted">at that airport</span>
          <input id={`item-${side}-dt`} type="datetime-local" value={e.dt} onChange={(x) => set({ dt: x.target.value })} {...aria(`${path}.localDateTime`)} />
          {errMsg(`${path}.localDateTime`)}
        </label>
        <label className="field wide" htmlFor={`item-${side}-zone`}>
          Airport time zone
          {zoneOptions(`item-${side}-zone`, e.zone, (z) => set({ zone: z }), "Choose the airport's zone", `${path}.timeZone`)}
          {errMsg(`${path}.timeZone`)}
        </label>
        {showChoice(`${path}.timeDisambiguation`, e.choice) ? choiceSelect(`item-${side}-choice`, e.choice, (c) => set({ choice: c }), `${path}.timeDisambiguation`) : null}
      </fieldset>
    );
  };

  const importedLinks = v.links.filter((l) => providerLabel(l.url) && l.url.startsWith("https://") && l.url !== v.mapUrl);

  return (
    <Modal
      title={item ? "Edit event" : "Add to itinerary"}
      onClose={onClose}
      triggerSelector={triggerSelector}
      subtitle={<>{tripTitle}. A Google Maps, Apple Maps or OpenStreetMap link with coordinates puts the event on the day map.</>}
    >
      <form onSubmit={(e) => submit(e)} noValidate>
        <div className="form-grid">
          <label className="field wide" htmlFor="item-title">
            What is it?
            <input id="item-title" value={v.title} maxLength={200} placeholder="Dinner at Gion Karyu" onChange={(e) => up({ title: e.target.value })} {...aria("title")} />
            {errMsg("title")}
          </label>
          <label className="field" htmlFor="item-type">
            Type
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
          </label>
          <label className="field" htmlFor="item-booking">
            Booking
            <select id="item-booking" value={v.booking} onChange={(e) => up({ booking: e.target.value as typeof v.booking })} {...aria("bookingStatus")}>
              {!isFlight ? <option value="not_required">Nothing to book</option> : null}
              <option value="needs_booking">Needs booking</option>
              <option value="booked" disabled={isFlight && !flightReady && v.booking !== "booked"}>
                {isFlight && !flightReady ? "Booked (add both airports and times first)" : "Booked"}
              </option>
            </select>
            {errMsg("bookingStatus")}
          </label>
          {v.booking === "needs_booking" ? (
            <label className="field" htmlFor="item-due">
              Book by <span className="muted">optional</span>
              <input id="item-due" type="date" value={v.due} onChange={(e) => up({ due: e.target.value })} {...aria("bookingDueDate")} />
              {errMsg("bookingDueDate")}
            </label>
          ) : null}

          {isFlight ? (
            <>
              <label className="field" htmlFor="item-airline">
                Airline <span className="muted">optional</span>
                <input id="item-airline" value={v.airline} maxLength={80} onChange={(e) => up({ airline: e.target.value })} />
              </label>
              <label className="field" htmlFor="item-flightno">
                Flight number <span className="muted">optional</span>
                <input id="item-flightno" value={v.flightNumber} maxLength={16} onChange={(e) => up({ flightNumber: e.target.value })} />
              </label>
              {!v.dep.dt ? (
                <label className="field wide" htmlFor="item-planned">
                  Planned departure date <span className="muted">if you don&apos;t know the exact time yet</span>
                  <input id="item-planned" type="date" value={v.plannedDate} onChange={(e) => up({ plannedDate: e.target.value })} {...aria("plannedDepartureDate")} />
                  {errMsg("plannedDepartureDate")}
                </label>
              ) : null}
              {endpoint("dep", "Departure")}
              {endpoint("arr", "Arrival")}
              {v.booking === "booked" ? <p className="note wide">A booked flight needs both airports, local times and time zones.</p> : null}
            </>
          ) : (
            <>
              <label className="check wide">
                <input type="checkbox" checked={v.noDate} onChange={(e) => up({ noDate: e.target.checked })} /> No date yet (shown under Undated)
              </label>
              {!v.noDate ? (
                <>
                  <label className="field" htmlFor="item-localDate">
                    Date
                    <input id="item-localDate" type="date" value={v.date} onChange={(e) => up({ date: e.target.value })} {...aria("localDate")} />
                    {errMsg("localDate")}
                  </label>
                  <label className="field" htmlFor="item-time">
                    Time <span className="muted">optional</span>
                    <input id="item-time" type="time" value={v.time} onChange={(e) => up({ time: e.target.value })} {...aria("localTime")} />
                    {errMsg("localTime")}
                  </label>
                  {showChoice("timeDisambiguation", v.choice) ? choiceSelect("item-choice", v.choice, (c) => up({ choice: c }), "timeDisambiguation") : null}
                  <label className="field" htmlFor="item-zone">
                    Time zone <span className="muted">if not the trip&apos;s</span>
                    {zoneOptions("item-zone", v.zone, (z) => up({ zone: z }), `Trip zone (${tripZone})`, "timeZone")}
                  </label>
                  <label className="field" htmlFor="item-duration">
                    Duration in minutes <span className="muted">optional</span>
                    <input id="item-duration" type="number" min={1} max={20160} value={v.duration} onChange={(e) => up({ duration: e.target.value })} {...aria("durationMinutes")} />
                    {errMsg("durationMinutes")}
                  </label>
                </>
              ) : null}
            </>
          )}

          <label className="field" htmlFor="item-amount">
            Planned price <span className="muted">optional</span>
            <input id="item-amount" inputMode="decimal" placeholder="120" value={v.amount} onChange={(e) => up({ amount: e.target.value })} {...aria("plannedPrice.amount")} />
            {errMsg("plannedPrice.amount")}
          </label>
          <label className="field" htmlFor="item-currency">
            Currency
            <select id="item-currency" value={v.currency} onChange={(e) => up({ currency: e.target.value })}>
              <CurrencyOptions recent={recentCurrencies} value={v.currency} />
            </select>
          </label>
          <label className="field wide" htmlFor="item-label">
            The price is a
            <select id="item-label" value={v.label} onChange={(e) => up({ label: e.target.value as "estimate" | "quote" })}>
              <option value="estimate">Estimate</option>
              <option value="quote">Quote</option>
            </select>
          </label>
          <label className="field wide" htmlFor="item-location">
            Place <span className="muted">optional</span>
            <input id="item-location" value={v.location} maxLength={500} placeholder="Fushimi Inari Taisha, Kyoto" onChange={(e) => up({ location: e.target.value })} />
          </label>
          <label className="field wide" htmlFor="item-map">
            Map link <span className="muted">optional, any https link</span>
            <input id="item-map" type="url" inputMode="url" value={v.mapUrl} placeholder="https://www.google.com/maps/place/…/@35.0,135.7,17z" onChange={(e) => up({ mapUrl: e.target.value })} {...aria("mapUrl")} />
            {errMsg("mapUrl")}
          </label>
          {importedLinks.length ? (
            <div className="wide">
              <span className="muted">Links on this event:</span>
              <div className="pills" style={{ justifyContent: "flex-start", marginTop: 6 }}>
                {importedLinks.map((l, i) => (
                  <button key={i} className="pill pill-quiet" type="button" onClick={() => up({ mapUrl: l.url })}>
                    Use {providerLabel(l.url)} link as map link
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="field wide" htmlFor="item-notes">
            Notes <span className="muted">optional</span>
            <textarea id="item-notes" maxLength={5000} value={v.notes} onChange={(e) => up({ notes: e.target.value })} />
          </label>
        </div>
        {message ? <p className="form-error" id="item-form-error" tabIndex={-1} role="alert" style={{ marginTop: 12 }}>{message}</p> : null}
        <div className="pills" style={{ marginTop: 14 }}>
          <button className="pill pill-quiet" type="button" onClick={onClose}>Cancel</button>
          {needTypeConfirm ? (
            <button className="pill pill-danger-fill" type="button" disabled={busy} onClick={(e) => submit(e, true)}>Change type and clear times</button>
          ) : (
            <button className="pill pill-fill" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add to itinerary"}</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
