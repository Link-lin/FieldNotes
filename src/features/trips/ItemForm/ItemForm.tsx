"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldError, ItemType, PlanItemDTO } from "@/shared/dto";
import type { ImportLocationCandidate, ImportLocationResult } from "@/shared/import";
import { coordinatesFromMapUrl, openStreetMapPointUrl, parseCoordinateText, providerLabel } from "@/shared/map-links";
import { Button } from "@/components/ui/Button/Button";
import { CheckField, Field, FieldGrid, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { api } from "@/lib/api";
import { fmtShort, TYPE_LABEL } from "@/lib/format";
import { TimeZoneSelect } from "@/features/trips/TripForm/TimeZoneSelect/TimeZoneSelect";
import { zoneLabel } from "@/features/trips/TripForm/TimeZoneSelect/zones";
import { FlightFields } from "./FlightFields/FlightFields";
import type { Choice, Endpoint } from "./item-form-types";
import styles from "./ItemForm.module.css";

type Props = {
  tripId: string;
  tripTitle: string;
  tripDestination: string;
  tripZone: string;
  /** The trip's dates, to warn when an event falls outside them (I6). */
  tripDates?: { startDate: string; endDate: string };
  defaultCurrency: string;
  recentCurrencies?: string[];
  defaultDate: string;
  item: PlanItemDTO | null;
  triggerSelector: string | null;
  onClose: () => void;
  onSaved: (item: PlanItemDTO, created: boolean) => void;
  surface?: "modal" | "panel";
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  panelHeading?: string;
  mapPreview?: React.ReactNode;
  /** Whether place lookup (Geoapify) is set up: Find place on map, and automatic pins for a new place name (MAP-2). */
  placeLookup?: boolean;
};

/** Add to itinerary / Edit event (TRIP-9). The server repeats every check. */
export function ItemForm({ tripId, tripTitle, tripDestination, tripZone, tripDates, defaultCurrency, recentCurrencies = [], defaultDate, item, triggerSelector, onClose, onSaved, surface = "modal", onDirtyChange, onBusyChange, panelHeading, mapPreview, placeLookup = false }: Props) {
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
  const [findingPlace, setFindingPlace] = useState(false);
  const [placeMatches, setPlaceMatches] = useState<ImportLocationCandidate[]>([]);
  const [placeQuery, setPlaceQuery] = useState("");
  const [chosenPlace, setChosenPlace] = useState<number | null>(null);
  const placeRequest = useRef(0);
  useEffect(() => () => { placeRequest.current++; }, []);
  const [placeMessage, setPlaceMessage] = useState<string | null>(null);
  const [lookupMapUrl, setLookupMapUrl] = useState<string | null>(null);
  const up = (patch: Partial<typeof v>) => {
    setV((o) => ({ ...o, ...patch }));
    onDirtyChange?.(true);
  };
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
    onBusyChange?.(true);
    setMessage(null);
    const r = item
      ? await api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${item.id}`, { item: payload(), expectedVersion: item.version, ...(confirmTypeChange ? { confirmTypeChange: true } : {}), ...(confirmPrice ? { confirmPrice: true } : {}) })
      : await api<PlanItemDTO>("POST", `/api/trips/${tripId}/items`, payload());
    setBusy(false);
    onBusyChange?.(false);
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
    setMessage(r.code === "version_conflict"
      ? "This event was changed elsewhere while you were editing (in another tab or window, by someone you share the trip with, or by a connected chat), so this wasn't saved. Your changes are still here: copy what you need, then go back to the event to see it as it is now."
      : r.message);
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
  const autoPin = !!item && item.coordinates?.source === "lookup" ? item.mapUrl : null;
  const autoPinned = !!autoPin && mapText === autoPin;
  const mapHint = !mapText
    ? placeLookup
      ? "Use Find place on map above, or paste a Google Maps, Apple Maps or OpenStreetMap link. Coordinates also work. Left empty, a place name with one clear match is pinned automatically after saving."
      : "Paste a Google Maps, Apple Maps or OpenStreetMap link. Coordinates also work."
    : autoPinned
      ? "Pinned automatically from the place name. Paste another link or coordinates to move the pin, or clear this field to remove it."
    : pin
      ? `Pins the stop at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}.`
      : "This link has no coordinates the app can read, so the event won't be on the day map. Try Find place on map above.";
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
  async function findPlace() {
    const location = v.location.trim();
    if (!location) return;
    const request = ++placeRequest.current;
    setFindingPlace(true);
    setPlaceMessage(null);
    setPlaceMatches([]);
    const result = await api<ImportLocationResult>("POST", "/api/places/resolve", { location, destination: tripDestination });
    if (request !== placeRequest.current) return;
    setFindingPlace(false);
    if (!result.ok) { setPlaceMessage(result.message); return; }
    setPlaceQuery(location);
    setPlaceMatches(result.data.candidates);
    setChosenPlace(result.data.suggestedIndex ?? null);
    if (!result.data.candidates.length) setPlaceMessage("No matching place found. Try a more specific place name.");
  }
  // I6: saving outside the trip is allowed (parking the night before), but say so while typing.
  const eventDay = isFlight ? (v.dep.dt ? v.dep.dt.slice(0, 10) : v.plannedDate) : v.noDate ? "" : v.date;
  const outsideTrip = !!tripDates && !!eventDay && (eventDay < tripDates.startDate || eventDay > tripDates.endDate);
  const outsideNote = outsideTrip && tripDates ? (
    <p className={`note ${styles.wide}`} role="status" id="item-outside-note">
      {fmtShort(eventDay)} is outside the trip ({fmtShort(tripDates.startDate)} to {fmtShort(tripDates.endDate)}). You can still save it; it will be listed under Outside trip dates.
    </p>
  ) : null;

  const form = (
      <form className={`${styles.form} ${surface === "panel" ? styles.panelForm : ""}`} onSubmit={(e) => submit(e)} noValidate>
        {surface === "panel" ? (
          <header className={styles.eventHead}>
            <p className={styles.eyebrow}>EDIT EVENT · {panelHeading}</p>
            <Field label="Event title" htmlFor="item-title" wide className={styles.titleField} {...fe("title")}>
              <textarea id="item-title" rows={2} value={v.title} maxLength={200} placeholder="Event title" onChange={(e) => up({ title: e.target.value })} {...aria("title")} />
            </Field>
            <p className="note">Changes are saved when you choose Save changes.</p>
          </header>
        ) : null}
        {surface === "panel" && mapPreview ? (
          <div className={styles.mapPreview}>
            {mapPreview}
            <p className="note">This map shows the saved place. It updates after you save changes.</p>
          </div>
        ) : null}
        <section className={styles.group} aria-label="Time and type">
          {surface === "panel" ? <h3 className={styles.sectionTitle}>Time &amp; type</h3> : null}
        <FieldGrid>
          {surface === "modal" ? (
          <Field label="What is it?" htmlFor="item-title" wide {...fe("title")}>
            <input id="item-title" value={v.title} maxLength={200} placeholder="Dinner at Gion Karyu" onChange={(e) => up({ title: e.target.value })} {...aria("title")} />
          </Field>
          ) : null}
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
                  error={err}
                  errorId={errId}
                  showChoice={showChoice(`${side === "dep" ? "departure" : "arrival"}.timeDisambiguation`, v[side].choice)}
                />
              ))}
              {outsideNote}
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
                  {outsideNote}
                  <Field label={<>Time {optional()}</>} htmlFor="item-time" {...fe("localTime")}>
                    <input id="item-time" type="time" value={v.time} onChange={(e) => up({ time: e.target.value })} {...aria("localTime")} />
                  </Field>
                  {showChoice("timeDisambiguation", v.choice) ? choiceField("item-choice", v.choice, (c) => up({ choice: c }), "timeDisambiguation") : null}
                  <TimeZoneSelect
                    id="item-zone"
                    label={<>Time zone {optional("if not the trip's")}</>}
                    hint="Only for an event that happens somewhere else, such as a call at home."
                    empty={`Trip zone (${zoneLabel(tripZone)})`}
                    value={v.zone}
                    onChange={(zone) => up({ zone })}
                    place={null}
                    currentZone={item?.timeZone ?? null}
                    fromPlace={false}
                    error={err("timeZone")}
                    errorId={errId("timeZone")}
                  />
                  <Field label={<>Duration in minutes {optional()}</>} htmlFor="item-duration" {...fe("durationMinutes")}>
                    <input id="item-duration" type="number" min={1} max={20160} value={v.duration} onChange={(e) => up({ duration: e.target.value })} {...aria("durationMinutes")} />
                  </Field>
                </>
              ) : null}
            </>
          )}
        </FieldGrid>
        </section>

        <section className={styles.group} aria-label="Booking and planned price">
          {surface === "panel" ? <h3 className={styles.sectionTitle}>Booking &amp; planned price</h3> : null}
        <FieldGrid>
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
              onChange={(e) => { setConfirmPrice(e.target.checked); onDirtyChange?.(true); }}
            />
          ) : null}
        </FieldGrid>
        </section>

        <section className={styles.group} aria-label="Place and map">
          {surface === "panel" ? <h3 className={styles.sectionTitle}>Place &amp; map</h3> : null}
        <FieldGrid>
          <Field label={<>Place {optional()}</>} htmlFor="item-location" wide>
            <input id="item-location" value={v.location} maxLength={500} placeholder="Fushimi Inari Taisha, Kyoto" onChange={(e) => { placeRequest.current++; setFindingPlace(false); up({ location: e.target.value, ...((lookupMapUrl && v.mapUrl === lookupMapUrl) || (autoPin && v.mapUrl === autoPin) ? { mapUrl: "" } : {}) }); setLookupMapUrl(null); setPlaceMatches([]); setPlaceMessage(null); }} />
          </Field>
          {!isFlight && placeLookup && v.location.trim() ? (
            <div className={styles.placeFinder}>
              <Button variant="quiet" onClick={findPlace} disabled={findingPlace || busy}>{findingPlace ? "Finding place…" : "Find place on map"}</Button>
              <span className="note">Sends this place and the trip destination to Geoapify. You choose the match before saving.</span>
              {placeMessage ? <span className="note" role="status">{placeMessage}</span> : null}
              {placeMatches.length && placeQuery === v.location.trim() ? (
                <div className={styles.placeChoices}>
                  <label htmlFor="item-place-match">Matching places</label>
                  <select id="item-place-match" value={chosenPlace ?? ""} onChange={(e) => setChosenPlace(e.target.value === "" ? null : Number(e.target.value))}>
                    <option value="">Choose a place</option>
                    {placeMatches.map((match, index) => <option key={`${match.latitude}-${match.longitude}-${index}`} value={index}>{match.label}</option>)}
                  </select>
                  <Button variant="outline" disabled={chosenPlace === null} onClick={() => { const match = chosenPlace === null ? null : placeMatches[chosenPlace]; if (match) { const url = openStreetMapPointUrl(match.latitude, match.longitude); setLookupMapUrl(url); up({ mapUrl: url }); } }}>Use this location</Button>
                  {chosenPlace !== null && placeMatches[chosenPlace] ? <a href={openStreetMapPointUrl(placeMatches[chosenPlace]!.latitude, placeMatches[chosenPlace]!.longitude)} target="_blank" rel="noopener noreferrer">View this match on a map ↗</a> : null}
                  <span className="note"><a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Powered by Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></span>
                </div>
              ) : null}
            </div>
          ) : null}
          <Field label={<>Map link or coordinates {optional()}</>} htmlFor="item-map" wide hint={mapHint} hintId="item-map-hint" {...fe("mapUrl")}>
            <input
              id="item-map"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={v.mapUrl}
              placeholder="Choose a place above or paste a map link"
              onChange={(e) => { setLookupMapUrl(null); up({ mapUrl: e.target.value }); }}
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
        </FieldGrid>
        </section>

        <section className={styles.group} aria-label="Notes">
          {surface === "panel" ? <h3 className={styles.sectionTitle}>Notes</h3> : null}
        <FieldGrid>
          <Field label={<>Notes {optional()}</>} htmlFor="item-notes" wide>
            <textarea id="item-notes" maxLength={5000} value={v.notes} onChange={(e) => up({ notes: e.target.value })} />
          </Field>
        </FieldGrid>
        </section>
        {message ? <FormError id="item-form-error">{message}</FormError> : null}
        <ModalActions>
          <Button variant="quiet" disabled={busy} onClick={onClose}>{surface === "panel" ? "Back to details" : "Cancel"}</Button>
          {needTypeConfirm ? (
            <Button variant="dangerFill" disabled={busy} onClick={(e) => submit(e, true)}>Change type and clear times</Button>
          ) : (
            <Button variant="fill" type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add to itinerary"}</Button>
          )}
        </ModalActions>
      </form>
  );
  if (surface === "panel") return form;
  return (
    <Modal
      title={item ? "Edit event" : "Add to itinerary"}
      onClose={onClose}
      triggerSelector={triggerSelector}
      subtitle={<>{tripTitle}. Find a place on the map, use a map link, or paste coordinates to pin this event.</>}
    >
      {form}
    </Modal>
  );
}
