"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FieldError, PlaceDTO, TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { CurrencyOptions, defaultCurrency } from "./CurrencyOptions";
import { DestinationInput } from "./DestinationInput";
import { commonZones, offsetMinutes, zoneLabel } from "./zones";
import { Modal } from "./Modal";
import { api } from "./api";
import { useToast } from "./Toast";
import { plural } from "./format";

type Trip = TripDetailDTO["trip"];
type DueWord = "upcoming" | "due_today" | "overdue";
type Impact = {
  items: Array<{ itemId: string; title: string; localDate: string; localTime: string; result: "ok" | "gap" | "ambiguous" }>;
  bookingTasksAffected: number;
  bookingTasks: Array<{ itemId: string; title: string; dueDate: string; before: DueWord; after: DueWord }>;
};
const DUE_WORD: Record<DueWord, string> = { upcoming: "not due yet", due_today: "due today", overdue: "overdue" };

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

const REGIONS: Array<[string, string]> = [
  ["Africa", "Africa"], ["America", "Americas"], ["Antarctica", "Antarctica"], ["Arctic", "Arctic"], ["Asia", "Asia"],
  ["Atlantic", "Atlantic Ocean"], ["Australia", "Australia"], ["Europe", "Europe"], ["Indian", "Indian Ocean"], ["Pacific", "Pacific Ocean"],
];

/** Every zone, by region, west to east within a region. */
function groupedZones(all: string[]): Array<{ label: string; zones: Array<{ id: string; label: string }> }> {
  const groups = new Map<string, Array<{ id: string; label: string; off: number }>>();
  for (const z of all) {
    const region = REGIONS.find(([k]) => z.startsWith(`${k}/`))?.[1] ?? "Other";
    groups.set(region, [...(groups.get(region) ?? []), { id: z, label: zoneLabel(z), off: offsetMinutes(z) ?? 0 }]);
  }
  return [...REGIONS.map(([, l]) => l), "Other"]
    .filter((l) => groups.has(l))
    .map((l) => ({ label: l, zones: groups.get(l)!.sort((a, b) => a.off - b.off || a.label.localeCompare(b.label)) }));
}

/** New trip / Edit trip (DASH-3, DASH-6), including the time-zone impact check and Delete trip. */
export function TripForm({ trip, onClose, itemDates = [], recentCurrencies = [] }: { trip: Trip | null; onClose: () => void; itemDates?: string[]; recentCurrencies?: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const zoneList = useMemo(() => zones(), []);
  const zoneGroups = useMemo(() => groupedZones(zoneList), [zoneList]);
  const shortList = useMemo(() => commonZones(), []);
  const [allZones, setAllZones] = useState(false);
  // Zones suggested by the picked destination; the first is applied to a new trip until the owner picks one.
  const [place, setPlace] = useState<PlaceDTO | null>(null);
  const [zoneTouched, setZoneTouched] = useState(false);
  const [v, setV] = useState({
    title: trip?.title ?? "",
    destination: trip?.destination ?? "",
    startDate: trip?.startDate ?? "",
    endDate: trip?.endDate ?? "",
    timeZone: trip?.timeZone ?? browserZone,
    budgetAmount: trip?.budget?.amount ?? "",
    budgetCurrency: trip?.budget?.currency ?? defaultCurrency(recentCurrencies),
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [choices, setChoices] = useState<Record<string, "earlier" | "later">>({});
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const err = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message;
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
    const map: Record<string, string> = { budget: "tf-budget" };
    const id = first ? map[first] ?? `tf-${first}` : null;
    requestAnimationFrame(() => (id ? document.getElementById(id) : document.getElementById("tf-form-error"))?.focus());
  }

  async function doDelete() {
    if (!trip) return;
    setBusy(true);
    const r = await api<void>("DELETE", `/api/trips/${trip.id}`, { confirm: true, expectedVersion: trip.version });
    setBusy(false);
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    toast({ message: "Trip deleted." });
    router.push("/");
    router.refresh();
  }

  if (deleting && trip) {
    return (
      <Modal title="Delete this trip?" onClose={() => setDeleting(false)} subtitle={<>This permanently deletes <b>{trip.title}</b>, its events and booking list, and revokes every invitation. There is no undo.</>}>
        <label className="field">
          Type the trip name to confirm
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" placeholder={trip.title} />
        </label>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <div className="pills">
          <button className="pill pill-quiet" type="button" onClick={() => setDeleting(false)}>Cancel</button>
          <button className="pill pill-danger-fill" type="button" disabled={confirmName !== trip.title || busy} onClick={doDelete}>Delete permanently</button>
        </div>
      </Modal>
    );
  }

  const field = (id: string, label: React.ReactNode, input: React.ReactElement, wide = false) => (
    <label className={`field${wide ? " wide" : ""}`} htmlFor={`tf-${id}`}>
      {label}
      {input}
      {err(id) ? <span className="field-error" id={`tf-${id}-err`}>{err(id)}</span> : null}
    </label>
  );
  const aria = (id: string) => (err(id) ? { "aria-invalid": true as const, "aria-describedby": `tf-${id}-err` } : {});
  const ambiguous = impact?.items.filter((i) => i.result === "ambiguous") ?? [];
  const gaps = impact?.items.filter((i) => i.result === "gap") ?? [];

  return (
    <Modal
      title={trip ? "Edit trip" : "New trip"}
      onClose={onClose}
      triggerSelector={trip ? "[data-edit-trip]" : null}
      subtitle={trip ? "Change the name, place, dates, time zone or budget. Your events keep their dates and times." : "Start with the basics. You can add events afterwards."}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          {field("title", "Trip name", <input id="tf-title" value={v.title} onChange={set("title")} maxLength={120} placeholder="Kyoto in autumn" {...aria("title")} />, true)}
          <div className="field wide">
            <label htmlFor="tf-destination">Main destination</label>
            <DestinationInput
              id="tf-destination"
              value={v.destination}
              onChange={(d) => {
                setV((o) => ({ ...o, destination: d }));
                if (place && d !== place.label) setPlace(null);
              }}
              onPick={(p) => {
                setPlace(p);
                const z = p.timeZones[0];
                if (!trip && !zoneTouched && z) setV((o) => ({ ...o, timeZone: z }));
              }}
              invalid={!!err("destination")}
              describedBy={err("destination") ? "tf-destination-err" : "tf-destination-hint"}
            />
            {err("destination") ? (
              <span className="field-error" id="tf-destination-err">{err("destination")}</span>
            ) : (
              <p className="field-hint" id="tf-destination-hint">Pick a suggestion to pin the trip on the globe, or type any name for a multi-stop trip.</p>
            )}
          </div>
          {field(
            "startDate",
            "Start date",
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
            />,
          )}
          {field("endDate", "End date", <input id="tf-endDate" type="date" value={v.endDate} min={v.startDate || undefined} onChange={set("endDate")} {...aria("endDate")} />)}
          <div className="field wide">
            <label htmlFor="tf-timeZone">Trip time zone</label>
            <select
              id="tf-timeZone"
              value={v.timeZone}
              onChange={(e) => {
                set("timeZone")(e);
                setZoneTouched(true);
                setImpact(null);
                setChoices({});
              }}
              aria-describedby={err("timeZone") ? "tf-timeZone-err" : "tf-timeZone-hint"}
              aria-invalid={err("timeZone") ? true : undefined}
            >
              {place?.timeZones.length ? (
                <optgroup label={`Suggested for ${place.label}`}>
                  {place.timeZones.map((z) => <option key={`s-${z}`} value={z}>{zoneLabel(z)}</option>)}
                </optgroup>
              ) : null}
              {(() => {
                // Zones already offered above the main list are not repeated in it.
                const above = new Set([...(place?.timeZones ?? []), browserZone, ...(trip ? [trip.timeZone] : [])]);
                const main = allZones ? zoneGroups : [{ label: "Time zones", zones: shortList }];
                const listed = new Set([...above, ...main.flatMap((g) => g.zones.map((z) => z.id))]);
                return (
                  <>
                    {!place?.timeZones.includes(browserZone) ? (
                      <optgroup label="This device">
                        <option value={browserZone}>{zoneLabel(browserZone)}</option>
                      </optgroup>
                    ) : null}
                    {trip && trip.timeZone !== browserZone && !place?.timeZones.includes(trip.timeZone) ? (
                      <optgroup label="Current">
                        <option value={trip.timeZone}>{zoneLabel(trip.timeZone)}</option>
                      </optgroup>
                    ) : null}
                    {!listed.has(v.timeZone) ? (
                      <optgroup label="Selected">
                        <option value={v.timeZone}>{zoneLabel(v.timeZone)}</option>
                      </optgroup>
                    ) : null}
                    {main.map((g) => (
                      <optgroup key={g.label} label={allZones ? `All time zones · ${g.label}` : g.label}>
                        {g.zones.filter((z) => !above.has(z.id)).map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                      </optgroup>
                    ))}
                  </>
                );
              })()}
            </select>
            {err("timeZone") ? (
              <span className="field-error" id="tf-timeZone-err">{err("timeZone")}</span>
            ) : (
              <p className="field-hint" id="tf-timeZone-hint">
                {place?.timeZones.length && !trip && !zoneTouched && v.timeZone === place.timeZones[0]
                  ? place.timeZones.length > 1
                    ? `Set from ${place.label}, which has ${place.timeZones.length} time zones. Pick the one where most of the trip happens.`
                    : `Set from ${place.label}.`
                  : "Book-by dates and times without their own zone use this zone."}{" "}
                <button className="link hint-link" type="button" onClick={() => setAllZones((x) => !x)} aria-controls="tf-timeZone">
                  {allZones ? "Show fewer" : `Not listed? Show all ${zoneList.length}`}
                </button>
              </p>
            )}
          </div>
          <div className="field wide">
            <label htmlFor="tf-budget">Budget <span className="muted">optional</span></label>
            <div className="money">
              <input id="tf-budget" inputMode="decimal" value={v.budgetAmount} onChange={set("budgetAmount")} placeholder="3500" {...aria("budget")} />
              <select id="tf-budgetCurrency" aria-label="Budget currency" value={v.budgetCurrency} onChange={set("budgetCurrency")}>
                <CurrencyOptions recent={recentCurrencies} value={v.budgetCurrency} />
              </select>
            </div>
            {err("budget") ? <span className="field-error" id="tf-budget-err">{err("budget")}</span> : null}
          </div>
        </div>
        {outside ? <p className="note" role="status">{plural(outside, "event")} will fall outside these dates. They stay on the trip, marked as outside the trip dates.</p> : null}
        {impact ? (
          <div className="card-surface" role="status" aria-live="polite">
            <b>Changing the time zone to {v.timeZone}</b>
            <p className="note">
              Events without their own time zone keep their local times, now read in {v.timeZone}.
              {!impact.items.length ? " No event times are affected." : ""}
            </p>
            {impact.items.filter((i) => i.result === "ok").length ? (
              <>
                <p className="note">These events keep their local time, which becomes a different moment:</p>
                <ul className="warnings impact-list">
                  {impact.items.filter((i) => i.result === "ok").map((i) => <li key={i.itemId}>{i.title}: {i.localDate} at {i.localTime}</li>)}
                </ul>
              </>
            ) : null}
            {impact.bookingTasks.length ? (
              <>
                <p className="note">Book-by dates are read in the new time zone ({plural(impact.bookingTasks.length, "booking task")}):</p>
                <ul className="warnings impact-list">
                  {impact.bookingTasks.map((b) => (
                    <li key={b.itemId}>
                      {b.title}: book by {b.dueDate}
                      {b.before !== b.after ? <b>, changes from {DUE_WORD[b.before]} to {DUE_WORD[b.after]}</b> : <>, stays {DUE_WORD[b.after]}</>}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {gaps.length ? (
              <ul className="warnings">
                {gaps.map((g) => <li key={g.itemId}>{g.title}: {g.localTime} doesn&apos;t exist on {g.localDate} in {v.timeZone}. Change that event first.</li>)}
              </ul>
            ) : null}
            {ambiguous.map((a) => (
              <label className="field" key={a.itemId}>
                {a.title}: {a.localTime} happens twice on {a.localDate}
                <select value={choices[a.itemId] ?? ""} onChange={(e) => setChoices((c) => ({ ...c, [a.itemId]: e.target.value as "earlier" | "later" }))}>
                  <option value="" disabled>Choose one</option>
                  <option value="earlier">The earlier one</option>
                  <option value="later">The later one</option>
                </select>
              </label>
            ))}
          </div>
        ) : null}
        {message ? <p className="form-error" id="tf-form-error" tabIndex={-1} role="alert">{message}</p> : null}
        <div className="pills" style={{ marginTop: 14 }}>
          <button className="pill pill-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="pill pill-fill" type="submit" disabled={busy || gaps.length > 0 || ambiguous.some((a) => !choices[a.itemId])}>
            {busy ? "Saving…" : trip ? (impact ? "Confirm and save" : "Save changes") : "Create trip"}
          </button>
        </div>
      </form>
      {trip ? (
        <div className="danger-zone">
          <b>Delete this trip</b>
          <p className="note">Removes the trip, its events and booking list, and revokes every invitation. This cannot be undone.</p>
          <div>
            <button className="pill pill-danger" type="button" onClick={() => setDeleting(true)}>Delete trip…</button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
