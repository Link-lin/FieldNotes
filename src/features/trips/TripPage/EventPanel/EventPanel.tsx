"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ItemType, PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { isAiDraft } from "@/shared/drafts";
import { providerLabel } from "@/shared/map-links";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { CheckIcon, CopyIcon, DotsIcon, TrashIcon } from "@/components/ui/Icon/icons";
import { Menu, MenuItem } from "@/components/ui/Menu/Menu";
import { FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { PanelNotice, SidePanel } from "@/components/ui/SidePanel/SidePanel";
import { Tag } from "@/components/ui/Tag/Tag";
import { fmtDay, TYPE_LABEL } from "@/lib/format";
import { StopNumber } from "../StopNumber/StopNumber";
import { dayTag, eventTimeText } from "../trip-days";
import { EventMap } from "./EventMap/EventMap";
import { EventProperties } from "./EventProperties/EventProperties";
import { EventTitle } from "./EventTitle/EventTitle";
import { FlightSection } from "./FlightSection/FlightSection";
import { NewEvent } from "./NewEvent/NewEvent";
import { NotesEditor, type NotesEditorHandle } from "./NotesEditor/NotesEditor";
import { PlaceSection } from "./PlaceSection/PlaceSection";
import { WhenSection } from "./WhenSection/WhenSection";
import { saveEventFields } from "./event-edit";
import styles from "./EventPanel.module.css";

/** Asked before the panel goes away by other means (browser Back): true to let it go, false after asking about unsaved changes. */
export type PanelGuard = () => boolean;

type Props = {
  trip: TripDetailDTO["trip"];
  /** The event shown, or null for a new one (Add to itinerary). */
  item: PlanItemDTO | null;
  /** A new event's date: the day in view, or empty from Whole trip. */
  defaultDate?: string;
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
  /** Any change saved here: a field, a section, the title, a review. */
  onSaved: (item: PlanItemDTO) => void;
  /** A new event was added; the panel then shows it. */
  onCreated?: (item: PlanItemDTO) => void;
  onNotesSaved: (item: PlanItemDTO) => void;
  onDuplicate?: (item: PlanItemDTO) => void;
  onDelete?: (item: PlanItemDTO) => void;
  /** Whether place lookup is set up (MAP-2). */
  placeLookup?: boolean;
  /** Marks this AI draft reviewed, or back to a draft (IMPORT-7); resolves with the saved event, or null if it failed. */
  onReview?: (item: PlanItemDTO, reviewed: boolean) => Promise<PlanItemDTO | null>;
  defaultCurrency: string;
  recentCurrencies: string[];
  /** Opened with the row menu's Edit event: the title starts open. */
  focusTitle?: boolean;
  presentation?: "panel" | "page";
  triggerSelector?: string;
  guardRef?: React.RefObject<PanelGuard | null>;
};

/**
 * TRIP-9, TRIP-10: an event in a panel that slides in from the right (or as a page on phones), shown and edited in one
 * layout. Owners and editors change each value where it is: the title, type, booking and price save on their own;
 * When (or Flight) and Place & map open in place with their own Save; notes save as they type. Previous and next step
 * through the events in page order; the bar's menu duplicates or deletes. Unsaved changes are asked about before the
 * panel closes or moves on. A new event uses the same layout with every section open and one Add button.
 */
export function EventPanel(props: Props) {
  const { trip, item, open, gone = false, canEdit: mayEdit, presentation = "panel", guardRef } = props;
  const canEdit = mayEdit && !gone;
  const isNew = item === null;
  const ref = useRef<HTMLElement>(null);
  const notesRef = useRef<NotesEditorHandle>(null);
  const leaving = useRef(false);
  const titleId = useId();
  const formId = useId();
  const dirtyParts = useRef(new Map<string, boolean>());
  // Read when a close is asked for, which can come before a re-render: a ref, not state.
  const newDirty = useRef(false);
  const [creating, setCreating] = useState(false);
  const [waiting, setWaiting] = useState(false);
  // An action waiting on "discard your unsaved changes?".
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  // A way out after the notes failed to save: the owner stays by default, or leaves without them.
  const [unsavedExit, setUnsavedExit] = useState<(() => void) | null>(null);
  // The event just marked reviewed here, whose bar offers Undo in the same place (a toast would take focus out of the panel).
  const [reviewedHere, setReviewedHere] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // TRIP-9: a change to or from a flight clears the schedule, so it waits for a yes.
  const [typeAcross, setTypeAcross] = useState<ItemType | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeBusy, setTypeBusy] = useState(false);

  const onDirty = useCallback((key: string, dirty: boolean) => {
    dirtyParts.current.set(key, dirty);
  }, []);
  const isDirty = () => (isNew ? newDirty.current : [...dirtyParts.current.values()].some(Boolean));

  useEffect(() => {
    if (discard || unsavedExit) ref.current?.querySelector<HTMLElement>("[data-discard-keep]")?.focus();
  }, [discard, unsavedExit]);
  // The phone page opened with Edit event: its title starts open, and takes focus (a panel does this on opening).
  const focusTitle = presentation === "page" && props.focusTitle;
  useEffect(() => {
    if (focusTitle) ref.current?.querySelector<HTMLElement>("#ev-title")?.focus();
  }, [focusTitle]);

  // Browser Back while the panel is open (TRIP-1): it closes, unless something is unsaved, which is asked about first.
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = () => {
      if (!isDirty()) return true;
      setDiscard(() => () => props.onClose());
      return false;
    };
    return () => {
      guardRef.current = null;
    };
  });

  async function leaveNotes(nextAction: (fresh: PlanItemDTO | null) => void) {
    if (leaving.current) return;
    if (!notesRef.current) return nextAction(item);
    leaving.current = true;
    setWaiting(true);
    const result = await notesRef.current.flush();
    leaving.current = false;
    setWaiting(false);
    // A failed save keeps the view and the typed text; the owner can retry or choose to leave.
    if (result.ok === false) {
      setUnsavedExit(() => () => nextAction(item));
      return;
    }
    nextAction(result.item ?? item);
  }

  /** Runs an action that leaves what is open, asking first when something is unsaved. */
  function guarded(action: () => void) {
    if (isDirty()) setDiscard(() => action);
    else action();
  }

  function requestClose() {
    if (creating || waiting) return;
    if (unsavedExit) { setUnsavedExit(null); return; }
    if (discard) { setDiscard(null); return; }
    guarded(() => void leaveNotes(() => props.onClose()));
  }

  function confirmDiscard() {
    const action = discard;
    setDiscard(null);
    dirtyParts.current.clear();
    newDirty.current = false;
    action?.();
  }

  function leaveWithoutNotes() {
    const action = unsavedExit;
    setUnsavedExit(null);
    action?.();
  }

  // Stepping to the first or last event disables the button that was used; keep focus in the
  // panel (on the same button if still enabled, else the other one, else Close).
  function go(to: PlanItemDTO) {
    guarded(() => void leaveNotes(() => {
      dirtyParts.current.clear();
      props.onGo(to);
      requestAnimationFrame(() => {
        const panel = ref.current;
        if (!panel || panel.contains(document.activeElement)) return;
        const pick = ["[data-step]:not([disabled])", "[data-panel-close]"].map((q) => panel.querySelector<HTMLElement>(q)).find(Boolean);
        pick?.focus();
      });
    }));
  }

  async function review(reviewed: boolean) {
    if (!item || !props.onReview || reviewBusy) return;
    setReviewBusy(true);
    const saved = await props.onReview(item, reviewed);
    setReviewBusy(false);
    if (!saved) return;
    setReviewedHere(reviewed ? saved.id : null);
    // The control is in the bar, or under the tags on a phone: focus the one on screen.
    const shown = (selector: string) => [...(ref.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find((el) => el.getClientRects().length > 0);
    requestAnimationFrame(() => shown(reviewed ? "[data-review-undo]" : "[data-review]")?.focus());
  }

  async function changeTypeAcross() {
    if (!item || !typeAcross) return;
    setTypeBusy(true);
    setTypeError(null);
    // A flight either needs booking or is booked (FLIGHT-2).
    const status = typeAcross === "flight" && item.bookingStatus === "not_required" ? "needs_booking" : item.bookingStatus;
    const r = await saveEventFields(trip.id, item.id, { type: typeAcross, bookingStatus: status }, { type: item.type, bookingStatus: item.bookingStatus }, { confirmTypeChange: true });
    setTypeBusy(false);
    if (!r.ok) { setTypeError(r.message); return; }
    setTypeAcross(null);
    props.onSaved(r.item);
  }

  const notices = (
    <>
      {discard ? (
        <PanelNotice actions={<><Button data-discard-keep variant="quiet" onClick={() => setDiscard(null)}>Keep editing</Button><Button variant="danger" onClick={confirmDiscard}>Discard changes</Button></>}>
          You have unsaved changes. Discard them?
        </PanelNotice>
      ) : null}
      {unsavedExit ? (
        <PanelNotice actions={<><Button data-discard-keep variant="quiet" onClick={() => setUnsavedExit(null)}>Stay</Button><Button variant="danger" onClick={leaveWithoutNotes}>Leave without saving</Button></>}>
          Your notes haven&apos;t been saved. Stay to try again or copy them, or leave without them.
        </PanelNotice>
      ) : null}
      {waiting ? <p className={styles.waiting} role="status">Saving notes…</p> : null}
      {gone ? <div className={styles.gone}><Banner tone="info" role="status">This event was deleted elsewhere: in another tab or window, by someone you share the trip with, or by a connected chat.</Banner></div> : null}
    </>
  );

  if (isNew) {
    return (
      <SidePanel
        open={open}
        onClose={requestClose}
        onExited={props.onExited}
        presentation={presentation}
        size="wide"
        label="Add to itinerary"
        closeLabel="Close without adding"
        closeDisabled={creating}
        triggerSelector={props.triggerSelector}
        initialFocus={() => ref.current?.querySelector<HTMLElement>("#ev-title") ?? null}
        panelRef={ref}
        bar={<span className={styles.barTitle}>Add to itinerary</span>}
        notices={notices}
        footer={
          <>
            <Button variant="quiet" onClick={requestClose} disabled={creating}>Cancel</Button>
            <Button variant="fill" type="submit" form={formId} disabled={creating}>{creating ? "Adding…" : "Add to itinerary"}</Button>
          </>
        }
      >
        <NewEvent
          trip={trip}
          defaultDate={props.defaultDate ?? ""}
          defaultCurrency={props.defaultCurrency}
          recentCurrencies={props.recentCurrencies}
          placeLookup={props.placeLookup ?? false}
          formId={formId}
          onCreated={(saved) => { newDirty.current = false; props.onCreated?.(saved); }}
          onDirty={(dirty) => { newDirty.current = dirty; }}
          onBusy={setCreating}
        />
      </SidePanel>
    );
  }

  const f = item.flightDetails;
  const day = item.timelineDate;
  const draft = isAiDraft(item);
  const reviewControl = !canEdit || !props.onReview ? null : draft ? (
    <Button data-review onClick={() => void review(true)} disabled={reviewBusy || waiting}><CheckIcon /> Mark as reviewed</Button>
  ) : reviewedHere === item.id ? (
    <Button variant="quiet" data-review-undo onClick={() => void review(false)} disabled={reviewBusy || waiting}>Undo review</Button>
  ) : null;
  const when = [day ? dayTag(trip, day) : null, day ? fmtDay(day) : null, eventTimeText(item, trip.timeZone)].filter(Boolean).join(" · ");
  const canChange = canEdit && (props.onDuplicate || props.onDelete);

  return (
    <SidePanel
      open={open}
      onClose={requestClose}
      onExited={props.onExited}
      presentation={presentation}
      size="wide"
      labelledBy={titleId}
      closeLabel={presentation === "page" ? "Back to trip" : "Close event"}
      closeText="← Trip"
      closeDisabled={waiting}
      triggerSelector={props.triggerSelector ?? `[data-details="${item.id}"]`}
      initialFocus={props.focusTitle && canEdit ? () => ref.current?.querySelector<HTMLElement>("#ev-title") ?? null : undefined}
      panelRef={ref}
      contentKey={item.id}
      barWraps
      bar={
        <div className={styles.step}>
          <Button variant="quiet" data-step="prev" disabled={!props.prev || waiting} onClick={() => props.prev && go(props.prev)} aria-label={props.prev ? `Previous event: ${props.prev.title}` : "No previous event"}>‹ Previous</Button>
          <Button variant="quiet" data-step="next" disabled={!props.next || waiting} onClick={() => props.next && go(props.next)} aria-label={props.next ? `Next event: ${props.next.title}` : "No next event"}>Next ›</Button>
        </div>
      }
      actions={
        <>
          {/* IMPORT-7: in the bar (under the tags on a phone, where the bar has no room). */}
          {reviewControl ? <span className={styles.reviewInBar}>{reviewControl}</span> : null}
          {canChange ? (
            <Menu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              className={styles.moreMenu}
              popupClassName={styles.menuPopup}
              trigger={(p) => <button type="button" className={styles.more} data-event-menu aria-label={`More actions for ${item.title}`} {...p}><DotsIcon /></button>}
            >
              {props.onDuplicate ? <MenuItem icon={<CopyIcon />} onClick={() => { setMenuOpen(false); guarded(() => void leaveNotes(() => props.onDuplicate!(item))); }}>Duplicate</MenuItem> : null}
              {props.onDelete ? <MenuItem icon={<TrashIcon />} danger onClick={() => { setMenuOpen(false); guarded(() => void leaveNotes(() => props.onDelete!(item))); }}>Delete event</MenuItem> : null}
            </Menu>
          ) : null}
        </>
      }
      notices={notices}
    >
      <header className={styles.head}>
        <p className={styles.when}>
          {props.num ? <StopNumber n={props.num.n} need={props.num.need} /> : null}
          <span>{when}</span>
        </p>
        <EventTitle tripId={trip.id} item={item} canEdit={canEdit} headingId={titleId} startOpen={props.focusTitle} onSaved={props.onSaved} onDirty={onDirty} />
        <div className={styles.tags}>
          {item.bookingStatus === "needs_booking" ? <Tag tone="need">Needs booking</Tag> : null}
          {item.bookingStatus === "booked" ? <Tag tone="booked">Booked</Tag> : null}
          {draft ? <Tag tone="soft">AI draft, unverified</Tag> : null}
        </div>
        {reviewControl ? <p className={styles.reviewInHead}>{reviewControl}</p> : null}
        <span role="status" className="visually-hidden">{!draft && reviewedHere === item.id ? "Marked as reviewed. The price stays an estimate until you confirm it." : ""}</span>
      </header>

      <EventMap item={item} destination={trip.destination} mapsKey={props.mapsKey} />

      <section className={styles.section} aria-label="Details">
        <EventProperties tripId={trip.id} item={item} canEdit={canEdit} defaultCurrency={props.defaultCurrency} recentCurrencies={props.recentCurrencies} onSaved={props.onSaved} onTypeAcross={(type) => { setTypeError(null); setTypeAcross(type); }} onDirty={onDirty} />
      </section>

      {f ? (
        <FlightSection trip={trip} item={item} canEdit={canEdit} onSaved={props.onSaved} onDirty={onDirty} />
      ) : (
        <WhenSection trip={trip} item={item} canEdit={canEdit} onSaved={props.onSaved} onDirty={onDirty} />
      )}

      <PlaceSection trip={trip} item={item} canEdit={canEdit} placeLookup={props.placeLookup ?? false} onSaved={props.onSaved} onDirty={onDirty} />

      {item.links.length ? (
        <section className={styles.section} aria-labelledby={`${titleId}-links`}>
          <h3 className={styles.label} id={`${titleId}-links`}>Links</h3>
          <div className={styles.links}>
            {item.links.map((l, i) => (
              <ButtonLink key={i} variant="quiet" external href={l.url}>{l.label} · {providerLabel(l.url)} ↗</ButtonLink>
            ))}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <NotesEditor ref={notesRef} tripId={trip.id} item={item} onSaved={props.onNotesSaved} />
      ) : (
        <section className={styles.section} aria-labelledby={`${titleId}-notes`}>
          <h3 className={styles.label} id={`${titleId}-notes`}>Notes</h3>
          {item.notes ? <p className={styles.notes}>{item.notes}</p> : <p className="note">No notes.</p>}
        </section>
      )}

      {typeAcross ? (
        <Modal
          title={typeAcross === "flight" ? "Make this a flight?" : `Make this ${TYPE_LABEL[typeAcross].toLowerCase()} instead of a flight?`}
          onClose={() => setTypeAcross(null)}
          fallbackFocus={() => ref.current?.querySelector<HTMLElement>('[data-inline-edit="Type"]') ?? null}
          subtitle={typeAcross === "flight" ? "A flight keeps its airports and local times instead of a date and time, so this event's date, time, zone and duration are cleared. Add the flight's details afterwards." : "This clears the flight's airline, number, airports and times. Add the date and time afterwards."}
        >
          {typeError ? <FormError>{typeError}</FormError> : null}
          <ModalActions>
            <Button variant="quiet" onClick={() => setTypeAcross(null)} disabled={typeBusy}>Keep the type</Button>
            <Button variant="dangerFill" onClick={() => void changeTypeAcross()} disabled={typeBusy}>{typeBusy ? "Changing…" : "Change type and clear times"}</Button>
          </ModalActions>
        </Modal>
      ) : null}
    </SidePanel>
  );
}
