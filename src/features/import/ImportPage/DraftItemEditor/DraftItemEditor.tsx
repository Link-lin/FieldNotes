"use client";

import { useMemo } from "react";
import type { FieldError } from "@/shared/dto";
import type { ImportLocationCandidate, ImportPreviewDTO } from "@/shared/import";
import { Button } from "@/components/ui/Button/Button";
import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { Tag } from "@/components/ui/Tag/Tag";
import { PickerInput } from "../PickerInput/PickerInput";
import { previewGlance } from "../preview-summary";
import { MapSuggestion } from "./MapSuggestion/MapSuggestion";
import styles from "./DraftItemEditor.module.css";

type Row = ImportPreviewDTO["items"][number];
type Props = {
  row: Row; errors: FieldError[]; busy: boolean; canRemoveEmptySourceValues: boolean; tripZone: string | null;
  /** Whether the edit form is showing; the page holds it so Expand all and Collapse all can set every card. */
  open: boolean; onOpenChange: (open: boolean) => void;
  onChange: (path: string, value: unknown) => void; onIncluded: (included: boolean) => void; onRemoveUnsupported: () => void; onRemoveEmptySourceValues: () => void;
  lookup: { status: "loading" | "ready" | "error"; candidates: ImportLocationCandidate[]; selected: number | null } | null;
  onSelectLocation: (selected: number | null) => void;
  onRetryLocation: () => void;
};
const TYPES = ["flight", "lodging", "transport", "meal", "activity", "other"];

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function valueAt(root: unknown, path: string): unknown { return path.split(".").reduce<unknown>((part, key) => record(part)[key], root); }
function text(value: unknown): string { return value == null ? "" : typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value); }
function normalizedPath(path: string): string { return path.replace(/^items(?:\[\d+\]|\.\d+)\./, "").replace(/\[(\d+)\]/g, ".$1"); }
function emptyFlightDetails() {
  const endpoint = () => ({ airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null });
  return { plannedDepartureDate: null, airline: null, flightNumber: null, departure: endpoint(), arrival: endpoint() };
}

/** One unsaved AI item. Each field is corrected here or the whole item is explicitly skipped. */
export function DraftItemEditor({ row, errors, busy, canRemoveEmptySourceValues, tripZone, open, onOpenChange, onChange, onIncluded, onRemoveUnsupported, onRemoveEmptySourceValues, lookup, onSelectLocation, onRetryLocation }: Props) {
  const id = (path: string) => `import-item-${row.index}-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const err = (path: string) => errors.find((e) => normalizedPath(e.path) === path)?.message;
  const field = (path: string) => ({ error: err(path), errorId: `${id(path)}-err` });
  const aria = (path: string) => err(path) ? { "aria-invalid": true as const, "aria-describedby": `${id(path)}-err` } : {};
  const val = (path: string) => text(valueAt(row.values, path));
  const set = (path: string, value: unknown) => onChange(path, value);
  const type = val("type");
  const isFlight = type === "flight";
  const links = useMemo(() => Array.isArray(row.values.links) ? row.values.links : [], [row.values.links]);
  const unsupportedType = type && !TYPES.includes(type);
  const booking = val("bookingStatus");
  const unsupportedBooking = booking && !["needs_booking", "not_required"].includes(booking);
  const unknownFields = errors.filter((error) => error.code === "unknown_field");
  const chosen = row.included ? "Skip item" : "Include item";
  const glance = previewGlance(row.values, tripZone);

  function changeType(next: string) {
    set("type", next);
    if (next === "flight") {
      set("bookingStatus", "needs_booking");
      set("flightDetails", emptyFlightDetails());
      for (const key of ["localDate", "localTime", "timeZone", "durationMinutes", "timeDisambiguation"]) set(key, null);
    } else set("flightDetails", null);
  }

  function linkRows(next: unknown[]) { set("links", next); }
  const link = (i: number, key: "label" | "url", value: string) => linkRows(links.map((entry, j) => j === i ? { ...record(entry), [key]: value } : entry));

  return (
    <li className={styles.item} data-excluded={!row.included}>
      <div className={styles.summary}>
        <div className={styles.head}>
          <span className="mono">#{row.index + 1} · {type || "Type missing"}</span>
          <h3>{val("title") || "Untitled item"}</h3>
          {glance.time || glance.place || glance.price ? (
            <p className={styles.glance}>
              {glance.time ? <span className={styles.time}>{glance.time}</span> : null}
              {glance.place ? <span className={styles.place}>{glance.place}</span> : null}
              {glance.price ? <span>{glance.price}</span> : null}
            </p>
          ) : null}
          <div className={styles.tags}>
            <Tag tone="soft">AI draft, unverified</Tag>
            {valueAt(row.values, "plannedPrice") ? <Tag tone="price">Price is an unverified estimate</Tag> : null}
            {errors.length ? <Tag tone="need">{errors.length} {errors.length === 1 ? "issue" : "issues"}</Tag> : null}
            {!row.included ? <Tag>Excluded</Tag> : null}
          </div>
          {row.included && !isFlight && val("location") ? <MapSuggestion id={row.index} lookup={lookup} busy={busy} onSelect={onSelectLocation} onRetry={onRetryLocation} /> : null}
        </div>
        <Button variant={row.included ? "quiet" : "outline"} onClick={() => onIncluded(!row.included)} disabled={busy} aria-label={`${chosen}: ${val("title") || `item ${row.index + 1}`}`}>{chosen}</Button>
      </div>
      {row.included ? (
        <details className={styles.details} open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
          <summary>Review and edit item</summary>
          {errors.length ? <ul className={styles.errors}>{errors.map((e, i) => <li key={`${e.path}-${i}`}>{e.message}</li>)}</ul> : null}
          {unknownFields.length ? (
            <div className={styles.unsupported}>
              <p>Unsupported fields: {unknownFields.map((error) => <code key={error.path}>{error.path.replace(/^items\[\d+\]\./, "")}</code>)}. These values are not in the editable preview.</p>
              <Button variant="quiet" onClick={onRemoveUnsupported} disabled={busy}>Remove these fields and keep item</Button>
              <p className="note">You can also skip the item or send the errors back to your AI chat for repair.</p>
            </div>
          ) : null}
          {canRemoveEmptySourceValues ? (
            <div className={styles.cleanAction}>
              <p className="note">The AI included empty values where JSON v1 requires them to be omitted.</p>
              <Button variant="quiet" onClick={onRemoveEmptySourceValues} disabled={busy}>Omit invalid empty values</Button>
            </div>
          ) : null}
          <fieldset disabled={busy} className={styles.fields}>
            <FieldGrid>
              <Field label="Type" htmlFor={id("type")} {...field("type")}>
                <select id={id("type")} value={type} onChange={(e) => changeType(e.target.value)} {...aria("type")}>
                  {unsupportedType ? <option value={type}>Unsupported: {type}</option> : null}
                  {!type ? <option value="">Choose a type</option> : null}
                  {TYPES.map((kind) => <option key={kind} value={kind}>{kind[0]!.toUpperCase() + kind.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Booking" htmlFor={id("bookingStatus")} {...field("bookingStatus")}>
                <select id={id("bookingStatus")} value={booking} onChange={(e) => set("bookingStatus", e.target.value)} {...aria("bookingStatus")}>
                  {unsupportedBooking ? <option value={booking}>Unsupported: {booking}</option> : null}
                  {!booking ? <option value="">Choose booking state</option> : null}
                  <option value="needs_booking">Needs booking</option>
                  {!isFlight ? <option value="not_required">Not required</option> : null}
                </select>
              </Field>
              <Field label="Title" htmlFor={id("title")} wide {...field("title")}>
                <input id={id("title")} value={val("title")} maxLength={200} onChange={(e) => set("title", e.target.value)} {...aria("title")} />
              </Field>
              {isFlight ? (
                <>
                  {(!row.values.flightDetails || typeof row.values.flightDetails !== "object" || Array.isArray(row.values.flightDetails)) ? (
                    <div className={styles.cleanAction}>
                      <p className="note">This flight needs a flightDetails object, even when segment details are unknown.</p>
                      <Button variant="quiet" onClick={() => set("flightDetails", emptyFlightDetails())}>Add empty flight details</Button>
                    </div>
                  ) : null}
                  {["localDate", "localTime", "timeZone", "durationMinutes", "timeDisambiguation"].some((key) => row.values[key as keyof typeof row.values] != null) ? (
                    <div className={styles.cleanAction}>
                      <p className="note">Flights cannot use the general event date, time, zone or duration fields.</p>
                      <Button variant="quiet" onClick={() => ["localDate", "localTime", "timeZone", "durationMinutes", "timeDisambiguation"].forEach((key) => set(key, null))}>Remove incompatible schedule fields</Button>
                    </div>
                  ) : null}
                  <Field label="Planned departure date, if exact departure is unknown" htmlFor={id("flightDetails.plannedDepartureDate")} wide {...field("flightDetails.plannedDepartureDate")}>
                    <PickerInput kind="date" format="YYYY-MM-DD" id={id("flightDetails.plannedDepartureDate")} value={val("flightDetails.plannedDepartureDate")} onChange={(v) => set("flightDetails.plannedDepartureDate", v || null)} {...aria("flightDetails.plannedDepartureDate")} />
                  </Field>
                  <Field label="Airline" htmlFor={id("flightDetails.airline")} {...field("flightDetails.airline")}>
                    <input id={id("flightDetails.airline")} value={val("flightDetails.airline")} maxLength={120} onChange={(e) => set("flightDetails.airline", e.target.value || null)} {...aria("flightDetails.airline")} />
                  </Field>
                  <Field label="Flight number" htmlFor={id("flightDetails.flightNumber")} {...field("flightDetails.flightNumber")}>
                    <input id={id("flightDetails.flightNumber")} value={val("flightDetails.flightNumber")} maxLength={24} onChange={(e) => set("flightDetails.flightNumber", e.target.value || null)} {...aria("flightDetails.flightNumber")} />
                  </Field>
                  {(["departure", "arrival"] as const).map((side) => (
                    <fieldset key={side} className={styles.endpoint}>
                      <legend className="mono">{side === "departure" ? "Departure" : "Arrival"}</legend>
                      {row.values.flightDetails && typeof row.values.flightDetails === "object" &&
                        (record(row.values.flightDetails)[side] === null || Array.isArray(record(row.values.flightDetails)[side])) ? (
                        <div className={styles.cleanAction}>
                          <p className="note">This endpoint must be an object. Replace the invalid value or skip the item.</p>
                          <Button variant="quiet" onClick={() => set(`flightDetails.${side}`, emptyFlightDetails()[side])}>Replace invalid {side} details</Button>
                        </div>
                      ) : null}
                      <FieldGrid>
                        <Field label="Airport code" htmlFor={id(`flightDetails.${side}.airportCode`)} {...field(`flightDetails.${side}.airportCode`)}>
                          <input id={id(`flightDetails.${side}.airportCode`)} value={val(`flightDetails.${side}.airportCode`)} maxLength={4} onChange={(e) => set(`flightDetails.${side}.airportCode`, e.target.value.toUpperCase() || null)} {...aria(`flightDetails.${side}.airportCode`)} />
                        </Field>
                        <Field label="Local date and time" htmlFor={id(`flightDetails.${side}.localDateTime`)} {...field(`flightDetails.${side}.localDateTime`)}>
                          <PickerInput kind="datetime-local" format="YYYY-MM-DDTHH:mm" id={id(`flightDetails.${side}.localDateTime`)} value={val(`flightDetails.${side}.localDateTime`)} onChange={(v) => set(`flightDetails.${side}.localDateTime`, v || null)} {...aria(`flightDetails.${side}.localDateTime`)} />
                        </Field>
                        <Field label="Airport time zone" htmlFor={id(`flightDetails.${side}.timeZone`)} wide {...field(`flightDetails.${side}.timeZone`)}>
                          <input id={id(`flightDetails.${side}.timeZone`)} value={val(`flightDetails.${side}.timeZone`)} placeholder="Asia/Tokyo" onChange={(e) => set(`flightDetails.${side}.timeZone`, e.target.value || null)} {...aria(`flightDetails.${side}.timeZone`)} />
                        </Field>
                        {(err(`flightDetails.${side}.timeDisambiguation`) || val(`flightDetails.${side}.timeDisambiguation`)) ? (
                          <Field label="Repeated local time" htmlFor={id(`flightDetails.${side}.timeDisambiguation`)} wide {...field(`flightDetails.${side}.timeDisambiguation`)}>
                            <select id={id(`flightDetails.${side}.timeDisambiguation`)} value={val(`flightDetails.${side}.timeDisambiguation`)} onChange={(e) => set(`flightDetails.${side}.timeDisambiguation`, e.target.value || null)} {...aria(`flightDetails.${side}.timeDisambiguation`)}>
                              <option value="">Choose one</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
                            </select>
                          </Field>
                        ) : null}
                      </FieldGrid>
                    </fieldset>
                  ))}
                </>
              ) : (
                <>
                  {row.values.flightDetails != null ? (
                    <div className={styles.cleanAction}>
                      <p className="note">Only flight items can keep flight details.</p>
                      <Button variant="quiet" onClick={() => set("flightDetails", null)}>Remove flight details</Button>
                    </div>
                  ) : null}
                  <Field label="Date" htmlFor={id("localDate")} {...field("localDate")}>
                    <PickerInput kind="date" format="YYYY-MM-DD or leave blank" id={id("localDate")} value={val("localDate")} onChange={(v) => set("localDate", v || null)} {...aria("localDate")} />
                  </Field>
                  <Field label="Time" htmlFor={id("localTime")} {...field("localTime")}>
                    <PickerInput kind="time" format="HH:mm or leave blank" id={id("localTime")} value={val("localTime")} onChange={(v) => set("localTime", v || null)} {...aria("localTime")} />
                  </Field>
                  <Field label="Time zone, if different from trip" htmlFor={id("timeZone")} wide {...field("timeZone")}>
                    <input id={id("timeZone")} value={val("timeZone")} placeholder="Inherit trip time zone" onChange={(e) => set("timeZone", e.target.value || null)} {...aria("timeZone")} />
                  </Field>
                  <Field label="Duration in minutes" htmlFor={id("durationMinutes")} {...field("durationMinutes")}>
                    <input id={id("durationMinutes")} inputMode="numeric" value={val("durationMinutes")} placeholder="1–1440" onChange={(e) => set("durationMinutes", e.target.value ? (/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value) : null)} {...aria("durationMinutes")} />
                  </Field>
                  {(err("timeDisambiguation") || val("timeDisambiguation")) ? (
                    <Field label="Repeated local time" htmlFor={id("timeDisambiguation")} wide {...field("timeDisambiguation")}>
                      <select id={id("timeDisambiguation")} value={val("timeDisambiguation")} onChange={(e) => set("timeDisambiguation", e.target.value || null)} {...aria("timeDisambiguation")}>
                        <option value="">Choose one</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
                      </select>
                    </Field>
                  ) : null}
                </>
              )}
              <Field label="Planned amount (unverified estimate)" htmlFor={id("plannedPrice.amount")} {...field("plannedPrice.amount")}>
                <input id={id("plannedPrice.amount")} inputMode="decimal" value={val("plannedPrice.amount")} placeholder="Leave blank if unknown" onChange={(e) => set("plannedPrice.amount", e.target.value)} {...aria("plannedPrice.amount")} />
              </Field>
              <Field label="Price currency" htmlFor={id("plannedPrice.currency")} {...field("plannedPrice.currency")}>
                <input id={id("plannedPrice.currency")} value={val("plannedPrice.currency")} maxLength={3} placeholder="USD" onChange={(e) => set("plannedPrice.currency", e.target.value.toUpperCase())} {...aria("plannedPrice.currency")} />
              </Field>
              <Field label="Place" htmlFor={id("location")} wide {...field("location")}>
                <input id={id("location")} value={val("location")} maxLength={500} onChange={(e) => set("location", e.target.value || null)} {...aria("location")} />
              </Field>
              <Field label="Notes" htmlFor={id("notes")} wide {...field("notes")}>
                <textarea id={id("notes")} value={val("notes")} maxLength={5000} rows={3} onChange={(e) => set("notes", e.target.value || null)} {...aria("notes")} />
              </Field>
            </FieldGrid>
            {row.values.plannedPrice != null ? <Button variant="quiet" onClick={() => set("plannedPrice", null)}>Remove planned price</Button> : null}
            <div className={styles.links}>
              <h4>Links</h4>
              {!Array.isArray(row.values.links) && row.values.links !== undefined ? <p className="note">These links are invalid. Remove them or skip this item.</p> : null}
              {links.map((entry, i) => (
                <div className={styles.linkRow} key={i}>
                  <Field label={`Link ${i + 1} label`} htmlFor={id(`links.${i}.label`)} {...field(`links.${i}.label`)}>
                    <input id={id(`links.${i}.label`)} value={text(record(entry).label)} maxLength={80} onChange={(e) => link(i, "label", e.target.value)} {...aria(`links.${i}.label`)} />
                  </Field>
                  <Field label={`Link ${i + 1} URL`} htmlFor={id(`links.${i}.url`)} {...field(`links.${i}.url`)}>
                    <input id={id(`links.${i}.url`)} value={text(record(entry).url)} onChange={(e) => link(i, "url", e.target.value)} {...aria(`links.${i}.url`)} />
                  </Field>
                  <Button variant="quiet" onClick={() => linkRows(links.filter((_, j) => j !== i))}>Remove link</Button>
                </div>
              ))}
              <div className={styles.linkActions}>
                {links.length < 20 ? <Button variant="quiet" onClick={() => linkRows([...links, { label: "", url: "" }])}>Add link</Button> : null}
                {!Array.isArray(row.values.links) && row.values.links !== undefined ? <Button variant="quiet" onClick={() => linkRows([])}>Remove invalid links</Button> : null}
              </div>
            </div>
          </fieldset>
        </details>
      ) : null}
    </li>
  );
}
