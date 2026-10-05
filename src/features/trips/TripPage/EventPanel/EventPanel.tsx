"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { isAiDraft } from "@/shared/drafts";
import { googleSearchUrl, providerLabel } from "@/shared/map-links";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { CheckIcon, EditIcon, PinIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { dueText, fmtDay, priceText, TYPE_LABEL } from "@/lib/format";
import { useDialog } from "@/lib/use-dialog";
import { FlightCard } from "../FlightCard/FlightCard";
import { StopNumber } from "../StopNumber/StopNumber";
import { dayTag, eventTimeText } from "../trip-days";
import { ItemForm } from "@/features/trips/ItemForm/ItemForm";
import { EventMap } from "./EventMap/EventMap";
import { NotesEditor, type NotesEditorHandle } from "./NotesEditor/NotesEditor";
import styles from "./EventPanel.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  item: PlanItemDTO;
  /** False while the panel slides out; it unmounts (onExited) when that finishes. */
  open: boolean;
  /** The event was deleted elsewhere while the panel was open (TRIP-11): it shows its last details, read-only. */
  gone?: boolean;
  canEdit: boolean;
  num: { n: number; need: boolean } | null;
  mapsKey: string | null;
  /** The previous and next events in the order the page shows them, if any. */
  prev: PlanItemDTO | null;
  next: PlanItemDTO | null;
  onGo: (item: PlanItemDTO) => void;
  onClose: () => void;
  onExited: () => void;
  onSaved: (item: PlanItemDTO) => void;
  onNotesSaved: (item: PlanItemDTO) => void;
  /** Marks this AI draft reviewed, or back to a draft (IMPORT-7); resolves with the saved event, or null if it failed. */
  onReview?: (item: PlanItemDTO, reviewed: boolean) => Promise<PlanItemDTO | null>;
  defaultCurrency: string;
  recentCurrencies: string[];
  initialEditing?: boolean;
  presentation?: "panel" | "page";
  triggerSelector?: string;
};

// Longest exit animation; unmount after it even when animations are off (reduced motion).
const EXIT_MS = 320;

/**
 * TRIP-10: an event's details in a panel that slides in from the right while the trip page fades
 * behind it: a live Google map of its place (MAP-8), time, booking and price, links, and notes the
 * owner edits in place. Previous and next step through the events in page order. Escape, the close
 * button or a click on the faded page closes it and returns focus to the event.
 */
export function EventPanel({ trip, item, open, gone = false, canEdit: mayEdit, num, mapsKey, prev, next, onGo, onClose, onExited, onSaved, onNotesSaved, onReview, defaultCurrency, recentCurrencies, initialEditing = false, presentation = "panel", triggerSelector }: Props) {
  const canEdit = mayEdit && !gone;
  const ref = useRef<HTMLElement>(null);
  const notesRef = useRef<NotesEditorHandle>(null);
  const leaving = useRef(false);
  const [editing, setEditing] = useState(initialEditing && canEdit);
  // The form edits the version it opened with, so a change made meanwhile elsewhere is reported on save, never overwritten.
  const [editItem, setEditItem] = useState<PlanItemDTO | null>(initialEditing && canEdit ? item : null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [discard, setDiscard] = useState<"close" | "details" | null>(null);
  // The event just marked reviewed here, which offers Undo in place (a toast would take focus out of the panel).
  const [reviewedHere, setReviewedHere] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  // A way out after the notes failed to save: the owner stays by default, or leaves without them.
  const [unsavedExit, setUnsavedExit] = useState<(() => void) | null>(null);
  const titleId = useId();
  const { onKeyDown, close } = useDialog(ref, {
    active: presentation === "panel" && open,
    onClose: requestClose,
    triggerSelector: triggerSelector ?? `[data-details="${item.id}"]`,
    initialFocus: () => ref.current?.querySelector<HTMLElement>("[data-panel-close]") ?? null,
  });
  useEffect(() => {
    if (discard || unsavedExit) ref.current?.querySelector<HTMLElement>("[data-discard-keep]")?.focus();
  }, [discard, unsavedExit]);
  // Unmount once the exit animation ends, or after its length when animations are off.
  const exited = useRef(onExited);
  useEffect(() => {
    exited.current = onExited;
  });
  useEffect(() => {
    if (open || presentation === "page") return;
    const t = setTimeout(() => exited.current(), EXIT_MS + 60);
    return () => clearTimeout(t);
  }, [open, presentation]);

  async function leaveNotes(nextAction: (fresh: PlanItemDTO) => void) {
    if (leaving.current) return;
    leaving.current = true;
    setWaiting(true);
    const result = await notesRef.current?.flush();
    leaving.current = false;
    setWaiting(false);
    // A failed save keeps the view and the typed text; the owner can retry or choose to leave.
    if (result?.ok === false) {
      setUnsavedExit(() => () => nextAction(item));
      return;
    }
    nextAction(result?.ok && result.item ? result.item : item);
  }

  function leaveWithoutNotes() {
    const action = unsavedExit;
    setUnsavedExit(null);
    action?.();
  }

  function requestClose() {
    if (busy || waiting) return;
    if (unsavedExit) { setUnsavedExit(null); return; }
    if (editing) {
      if (dirty) setDiscard("close");
      else onClose();
    } else void leaveNotes(() => onClose());
  }

  function backToDetails() {
    if (busy) return;
    if (dirty) setDiscard("details");
    else { setEditing(false); setEditItem(null); requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[data-panel-edit]")?.focus()); }
  }

  function startEditing() {
    void leaveNotes((fresh) => {
      setEditItem(fresh);
      setDirty(false);
      setEditing(true);
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("#item-title")?.focus());
    });
  }

  function confirmDiscard() {
    const action = discard;
    setDiscard(null);
    setDirty(false);
    if (action === "close") onClose();
    else { setEditing(false); setEditItem(null); requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[data-panel-edit]")?.focus()); }
  }

  // Stepping to the first or last event disables the button that was used; keep focus in the
  // panel (on the same button if still enabled, else the other one, else Close).
  function go(to: PlanItemDTO) {
    void leaveNotes(() => {
      onGo(to);
      requestAnimationFrame(() => {
        const panel = ref.current;
        if (!panel || panel.contains(document.activeElement)) return;
        const pick = ["[data-step]:not([disabled])", "[data-panel-close]"].map((q) => panel.querySelector<HTMLElement>(q)).find(Boolean);
        pick?.focus();
      });
    });
  }

  async function review(reviewed: boolean) {
    if (!onReview || reviewBusy) return;
    setReviewBusy(true);
    const saved = await onReview(item, reviewed);
    setReviewBusy(false);
    if (!saved) return;
    setReviewedHere(reviewed ? saved.id : null);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(reviewed ? "[data-review-undo]" : "[data-review]")?.focus());
  }

  const f = item.flightDetails;
  const day = item.timelineDate;
  const draft = isAiDraft(item);
  const when = [day ? dayTag(trip, day) : null, day ? fmtDay(day) : null, eventTimeText(item, trip.timeZone)].filter(Boolean).join(" · ");

  const surface = (
      <section className={styles.panel} data-presentation={presentation} data-mode={editing ? "edit" : "details"} role={presentation === "panel" ? "dialog" : undefined} aria-modal={presentation === "panel" ? true : undefined} aria-label={editing ? "Edit event" : undefined} aria-labelledby={editing ? undefined : titleId} ref={ref} onKeyDown={presentation === "panel" ? onKeyDown : undefined} inert={presentation === "panel" && !open}>
        <div className={styles.bar}>
          {editing ? <Button variant="quiet" onClick={backToDetails} disabled={busy}>← Event details</Button> : (
            <div className={styles.step}>
              <Button variant="quiet" data-step="prev" disabled={!prev || waiting} onClick={() => prev && go(prev)} aria-label={prev ? `Previous event: ${prev.title}` : "No previous event"}>‹ Previous</Button>
              <Button variant="quiet" data-step="next" disabled={!next || waiting} onClick={() => next && go(next)} aria-label={next ? `Next event: ${next.title}` : "No next event"}>Next ›</Button>
            </div>
          )}
          <div className={styles.barActions}>
            {!editing && canEdit ? <Button variant="fill" data-panel-edit onClick={startEditing} disabled={waiting}><EditIcon /> Edit event</Button> : null}
            <button type="button" className={styles.close} data-panel-close aria-label={presentation === "page" ? "Back to trip" : "Close event details"} disabled={busy || waiting} onClick={requestClose}>{presentation === "page" ? "← Trip" : "×"}</button>
          </div>
        </div>

        {discard ? (
          <div className={styles.discard} role="alert">
            <p>You have unsaved changes. Discard them?</p>
            <div><Button data-discard-keep variant="quiet" onClick={() => setDiscard(null)}>Keep editing</Button><Button variant="danger" onClick={confirmDiscard}>Discard changes</Button></div>
          </div>
        ) : null}
        {unsavedExit ? (
          <div className={styles.discard} role="alert">
            <p>Your notes haven&apos;t been saved. Stay to try again or copy them, or leave without them.</p>
            <div><Button data-discard-keep variant="quiet" onClick={() => setUnsavedExit(null)}>Stay</Button><Button variant="danger" onClick={leaveWithoutNotes}>Leave without saving</Button></div>
          </div>
        ) : null}
        {waiting ? <p className={styles.waiting} role="status">Saving notes…</p> : null}
        {gone ? <Banner tone="info" role="status">This event was deleted elsewhere: in another tab or window, by someone you share the trip with, or by a connected chat.</Banner> : null}

        {editing ? (
          <div className={styles.body}>
            <ItemForm
              key={item.id}
              surface="panel"
              tripId={trip.id}
              tripTitle={trip.title}
              tripDestination={trip.destination}
              tripZone={trip.timeZone}
              tripDates={trip}
              defaultCurrency={defaultCurrency}
              recentCurrencies={recentCurrencies}
              defaultDate=""
              item={editItem ?? item}
              triggerSelector={null}
              onClose={backToDetails}
              onDirtyChange={setDirty}
              onBusyChange={setBusy}
              panelHeading={when}
              mapPreview={<EventMap item={item} destination={trip.destination} mapsKey={mapsKey} />}
              onSaved={(saved) => {
                setDirty(false);
                setEditItem(null);
                setEditing(false);
                onSaved(saved);
                requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[data-panel-edit]")?.focus());
              }}
            />
          </div>
        ) : (
        <div className={styles.body} key={item.id}>
          <header className={styles.head}>
            <p className={styles.when}>
              {num ? <StopNumber n={num.n} need={num.need} /> : null}
              <span>{when}</span>
            </p>
            <h2 className={styles.title} id={titleId}>{item.title}</h2>
            <div className={styles.tags}>
              <Tag tone="soft">{TYPE_LABEL[item.type]}</Tag>
              {item.bookingStatus === "needs_booking" ? <Tag tone="need">Needs booking</Tag> : null}
              {item.bookingStatus === "booked" ? <Tag tone="booked">Booked</Tag> : null}
              {draft ? <Tag tone="soft">AI draft, unverified</Tag> : null}
            </div>
            {draft && canEdit && onReview ? (
              <p className={styles.review}>
                <Button variant="quiet" data-review onClick={() => void review(true)} disabled={reviewBusy}><CheckIcon /> Mark as reviewed</Button>
                <span className="note">When you have checked it: the AI draft tag goes, the price stays an estimate.</span>
              </p>
            ) : null}
            {!draft && reviewedHere === item.id ? (
              <p className={styles.review} role="status">
                <span>Marked as reviewed.</span>
                <Button variant="quiet" data-review-undo onClick={() => void review(false)} disabled={reviewBusy}>Undo</Button>
              </p>
            ) : null}
          </header>

          <EventMap item={item} destination={trip.destination} mapsKey={mapsKey} />

          {f ? <FlightCard item={item} /> : null}

          {item.location || item.mapUrl ? (
            <section className={styles.section} aria-label="Place">
              {item.location ? <p className={styles.place}><PinIcon />{item.location}</p> : null}
              <div className={styles.links}>
                {item.mapUrl ? (
                  <ButtonLink variant="quiet" external href={item.mapUrl}>Open in {item.mapProvider ?? "map"} ↗</ButtonLink>
                ) : item.location ? (
                  <ButtonLink variant="quiet" external href={googleSearchUrl(item.location)}>Open in Google Maps ↗</ButtonLink>
                ) : null}
              </div>
            </section>
          ) : null}

          <dl className={styles.facts}>
            {item.bookingStatus === "needs_booking" ? (
              <>
                <dt>Booking</dt>
                <dd>{dueText(item.bookingDueDate, item.bookingDueState ?? "upcoming")}</dd>
              </>
            ) : null}
            {item.plannedPrice ? (
              <>
                <dt>Planned price</dt>
                <dd>{priceText(item.plannedPrice)}</dd>
              </>
            ) : null}
            {item.source === "ai" && item.reviewedAt ? (
              <>
                <dt>Origin</dt>
                <dd>AI suggestion, reviewed</dd>
              </>
            ) : null}
            {item.durationMinutes ? (
              <>
                <dt>Duration</dt>
                <dd>{item.durationMinutes} min</dd>
              </>
            ) : null}
          </dl>

          {item.links.length ? (
            <section className={styles.section} aria-label="Links">
              <div className={styles.links}>
                {item.links.map((l, i) => (
                  <ButtonLink key={i} variant="quiet" external href={l.url}>{l.label} · {providerLabel(l.url)} ↗</ButtonLink>
                ))}
              </div>
            </section>
          ) : null}

          {canEdit ? (
            <NotesEditor ref={notesRef} tripId={trip.id} item={item} onSaved={onNotesSaved} />
          ) : (
            <section className={styles.section} aria-label="Notes">
              <p className={styles.label}>Notes</p>
              {item.notes ? <p className={styles.notes}>{item.notes}</p> : <p className="note">No notes.</p>}
            </section>
          )}

        </div>
        )}
      </section>
  );
  if (presentation === "page") return <main className={styles.page}>{surface}</main>;
  return createPortal(
    <div
      className={styles.backdrop}
      data-modal
      data-state={open ? "open" : "closing"}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onAnimationEnd={(e) => { if (!open && e.target === e.currentTarget) onExited(); }}
    >
      {surface}
    </div>, document.body,
  );
}
