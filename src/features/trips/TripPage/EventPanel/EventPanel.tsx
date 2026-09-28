"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { googleDirectionsUrl, googleSearchUrl, providerLabel } from "@/shared/map-links";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { EditIcon, PinIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { dueText, fmtDay, priceText, TYPE_LABEL } from "@/lib/format";
import { useDialog } from "@/lib/use-dialog";
import { FlightCard } from "../FlightCard/FlightCard";
import { StopNumber } from "../StopNumber/StopNumber";
import { dayTag, eventTimeText } from "../trip-days";
import { EventMap } from "./EventMap/EventMap";
import { NotesEditor } from "./NotesEditor/NotesEditor";
import styles from "./EventPanel.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  item: PlanItemDTO;
  /** False while the panel slides out; it unmounts (onExited) when that finishes. */
  open: boolean;
  owner: boolean;
  num: { n: number; need: boolean } | null;
  mapsKey: string | null;
  /** The previous and next events in the order the page shows them, if any. */
  prev: PlanItemDTO | null;
  next: PlanItemDTO | null;
  onGo: (item: PlanItemDTO) => void;
  onClose: () => void;
  onExited: () => void;
  onEdit: (item: PlanItemDTO) => void;
  onNotesSaved: (item: PlanItemDTO) => void;
};

// Longest exit animation; unmount after it even when animations are off (reduced motion).
const EXIT_MS = 320;

/**
 * TRIP-10: an event's details in a panel that slides in from the right while the trip page fades
 * behind it: a live Google map of its place (MAP-8), time, booking and price, links, and notes the
 * owner edits in place. Previous and next step through the events in page order. Escape, the close
 * button or a click on the faded page closes it and returns focus to the event.
 */
export function EventPanel({ trip, item, open, owner, num, mapsKey, prev, next, onGo, onClose, onExited, onEdit, onNotesSaved }: Props) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const { onKeyDown, close } = useDialog(ref, {
    active: open,
    onClose,
    triggerSelector: `[data-details="${item.id}"]`,
    initialFocus: () => ref.current?.querySelector<HTMLElement>("[data-panel-close]") ?? null,
  });
  // Unmount once the exit animation ends, or after its length when animations are off.
  const exited = useRef(onExited);
  useEffect(() => {
    exited.current = onExited;
  });
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => exited.current(), EXIT_MS + 60);
    return () => clearTimeout(t);
  }, [open]);

  // Stepping to the first or last event disables the button that was used; keep focus in the
  // panel (on the same button if still enabled, else the other one, else Close).
  function go(to: PlanItemDTO) {
    onGo(to);
    requestAnimationFrame(() => {
      const panel = ref.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const pick = ["[data-step]:not([disabled])", "[data-panel-close]"].map((q) => panel.querySelector<HTMLElement>(q)).find(Boolean);
      pick?.focus();
    });
  }

  const f = item.flightDetails;
  const day = item.timelineDate;
  const when = [day ? dayTag(trip, day) : null, day ? fmtDay(day) : null, eventTimeText(item, trip.timeZone)].filter(Boolean).join(" · ");

  return createPortal(
    <div
      className={styles.backdrop}
      data-modal
      data-state={open ? "open" : "closing"}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onAnimationEnd={(e) => {
        if (!open && e.target === e.currentTarget) onExited();
      }}
    >
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={onKeyDown} inert={!open}>
        <div className={styles.bar}>
          <div className={styles.step}>
            <Button variant="quiet" data-step="prev" disabled={!prev} onClick={() => prev && go(prev)} aria-label={prev ? `Previous event: ${prev.title}` : "No previous event"}>‹ Previous</Button>
            <Button variant="quiet" data-step="next" disabled={!next} onClick={() => next && go(next)} aria-label={next ? `Next event: ${next.title}` : "No next event"}>Next ›</Button>
          </div>
          <button type="button" className={styles.close} data-panel-close aria-label="Close event details" onClick={close}>×</button>
        </div>

        {/* Keyed by event so moving to another one fades its content in afresh. */}
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
              {item.source === "ai" ? <Tag tone="soft">AI draft, unverified</Tag> : null}
            </div>
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
                {item.location ? <ButtonLink variant="quiet" external href={googleDirectionsUrl(item.location)}>Directions ↗</ButtonLink> : null}
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

          {owner ? (
            <NotesEditor tripId={trip.id} item={item} onSaved={onNotesSaved} />
          ) : (
            <section className={styles.section} aria-label="Notes">
              <p className={styles.label}>Notes</p>
              {item.notes ? <p className={styles.notes}>{item.notes}</p> : <p className="note">No notes.</p>}
            </section>
          )}

          {owner ? (
            <div className={styles.actions}>
              <Button onClick={() => onEdit(item)}><EditIcon /> Edit event</Button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
