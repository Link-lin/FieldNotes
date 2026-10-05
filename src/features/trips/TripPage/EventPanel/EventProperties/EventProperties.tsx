"use client";

import { useEffect } from "react";
import type { ItemType, PlanItemDTO } from "@/shared/dto";
import { flightReadyToBook } from "@/shared/booking";
import { itemInputOf } from "@/shared/fields";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { InlineEdit } from "@/components/ui/InlineEdit/InlineEdit";
import { dueText, priceText, TYPE_LABEL } from "@/lib/format";
import { useInlineField, type FieldSaveResult } from "@/lib/use-inline-field";
import { bookingDraftOf, bookingFields, fieldId, priceDraftOf, priceFields, saveEventFields, saveFailure, type BookingDraft } from "../event-edit";
import { BookingFields } from "../BookingFields/BookingFields";
import { PriceFields } from "../PriceFields/PriceFields";
import styles from "./EventProperties.module.css";

type Props = {
  tripId: string;
  item: PlanItemDTO;
  canEdit: boolean;
  defaultCurrency: string;
  recentCurrencies: string[];
  onSaved: (item: PlanItemDTO) => void;
  /** A change to or from a flight clears the schedule, so the panel asks first (TRIP-9). */
  onTypeAcross: (type: ItemType) => void;
  onDirty: (key: string, dirty: boolean) => void;
};

const STATUS_TEXT = { not_required: "Nothing to book", needs_booking: "Needs booking", booked: "Booked" } as const;

/**
 * The event's properties under its title (TRIP-10): type, booking and planned price, each edited where it is shown and
 * saved on its own, and where an AI suggestion came from. A change that moves the event's state (booking) offers Undo.
 */
export function EventProperties({ tripId, item, canEdit, defaultCurrency, recentCurrencies, onSaved, onTypeAcross, onDirty }: Props) {
  const isFlight = item.type === "flight";
  const save = async (next: Record<string, unknown>, start: Record<string, unknown>, opts?: { confirmPrice?: boolean }): Promise<FieldSaveResult & { item?: PlanItemDTO }> => {
    const r = await saveEventFields(tripId, item.id, next, start, opts);
    if (!r.ok) return saveFailure(r);
    onSaved(r.item);
    return { ok: true, item: r.item };
  };

  const type = useInlineField<ItemType>({
    read: () => item.type,
    save: (next, start) => save({ type: next }, { type: start }),
  });

  const booking = useInlineField<BookingDraft>({
    read: () => bookingDraftOf(item),
    save: async (next, start) => {
      const r = await save(bookingFields(next), bookingFields(start));
      if (!r.ok || next.status === start.status) return r;
      return { ok: true, note: next.status === "booked" ? "Marked booked." : "Saved", undo: () => save(bookingFields(start), bookingFields(next)) };
    },
  });

  const price = useInlineField({
    read: () => priceDraftOf(item, defaultCurrency),
    save: (next, start) => save(priceFields(next), priceFields(start)),
  });

  useEffect(() => onDirty("booking", booking.dirty), [booking.dirty, onDirty]);
  useEffect(() => onDirty("price", price.dirty), [price.dirty, onDirty]);

  const f = item.flightDetails;
  const flightReady = !!f && flightReadyToBook({ departure: f.departure, arrival: f.arrival });
  const p = item.plannedPrice;

  async function confirmAiPrice() {
    const start = itemInputOf(item).plannedPrice;
    await save({ plannedPrice: start }, { plannedPrice: start }, { confirmPrice: true });
  }

  return (
    <dl className={styles.props}>
      <dt>Type</dt>
      <dd>
        <InlineEdit
          label="Type"
          canEdit={canEdit}
          editing={type.editing}
          onEdit={type.open}
          onCommit={() => void type.commit()}
          onCancel={type.cancel}
          status={type.status}
          controls={({ describedBy }) => (
            <Field label="Type" htmlFor={fieldId("type")}>
              <select
                id={fieldId("type")}
                value={type.draft}
                aria-describedby={describedBy}
                onChange={(e) => {
                  const next = e.target.value as ItemType;
                  // Becoming a flight, or no longer one, clears the schedule: the panel asks first.
                  if ((next === "flight") !== isFlight) {
                    type.cancel();
                    onTypeAcross(next);
                  } else void type.commit(next);
                }}
              >
                {(Object.keys(TYPE_LABEL) as ItemType[]).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}
              </select>
            </Field>
          )}
        >
          {TYPE_LABEL[item.type]}
        </InlineEdit>
      </dd>

      <dt>Booking</dt>
      <dd>
        <InlineEdit
          label="Booking"
          valueText={STATUS_TEXT[item.bookingStatus]}
          canEdit={canEdit}
          editing={booking.editing}
          onEdit={booking.open}
          onCommit={() => void booking.commit()}
          onCancel={booking.cancel}
          status={booking.status}
          onUndo={() => void booking.undo()}
          controls={({ describedBy }) => (
            <BookingFields value={booking.draft} onChange={(patch) => booking.setDraft((d) => ({ ...d, ...patch }))} error={booking.error} isFlight={isFlight} flightReady={flightReady} describedBy={describedBy} />
          )}
        >
          <span className={styles.booking} data-state={item.bookingStatus} data-due={item.bookingDueState ?? undefined}>
            {STATUS_TEXT[item.bookingStatus]}
            {item.bookingStatus === "needs_booking" ? <span className={styles.due}> · {dueText(item.bookingDueDate, item.bookingDueState ?? "upcoming")}</span> : null}
          </span>
        </InlineEdit>
      </dd>

      {canEdit || p ? (
        <>
          <dt>Planned price</dt>
          <dd>
            <InlineEdit
              label="Planned price"
              valueText={p ? priceText(p) : undefined}
              placeholder="Add a price"
              empty={!p}
              canEdit={canEdit}
              editing={price.editing}
              onEdit={price.open}
              onCommit={() => void price.commit()}
              onCancel={price.cancel}
              status={price.status}
              controls={({ describedBy }) => (
                <PriceFields value={price.draft} onChange={(patch) => price.setDraft((d) => ({ ...d, ...patch }))} error={price.error} recentCurrencies={recentCurrencies} describedBy={describedBy} />
              )}
            >
              {p ? priceText(p) : ""}
            </InlineEdit>
            {canEdit && p?.source === "ai" && !price.editing ? (
              <p className={styles.aiPrice}>
                <span className="note">An AI estimate until you check it.</span>
                <Button variant="quiet" onClick={() => void confirmAiPrice()}>I checked this price</Button>
              </p>
            ) : null}
          </dd>
        </>
      ) : null}

      {item.source === "ai" && item.reviewedAt ? (
        <>
          <dt>Origin</dt>
          <dd>AI suggestion, reviewed</dd>
        </>
      ) : null}
    </dl>
  );
}
