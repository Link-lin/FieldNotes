"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MoneyDTO, TripDetailDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { InlineEdit } from "@/components/ui/InlineEdit/InlineEdit";
import { SectionFrame } from "@/components/ui/EditSection/EditSection";
import { PanelNotice, SidePanel } from "@/components/ui/SidePanel/SidePanel";
import { defaultCurrency } from "@/features/currency/CurrencyOptions/CurrencyOptions";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { formatMoney } from "@/shared/money";
import { PanelEdits, useInlineField, usePanelEdits } from "@/lib/use-inline-field";
import { DatesSection } from "./DatesSection/DatesSection";
import { DeleteTripDialog } from "./DeleteTripDialog/DeleteTripDialog";
import { DestinationInput } from "./DestinationInput/DestinationInput";
import { GlobePoint } from "./GlobePoint/GlobePoint";
import { NewTrip } from "./NewTrip/NewTrip";
import { TripTitleField } from "./TripTitleField/TripTitleField";
import { ZoneSection } from "./ZoneSection/ZoneSection";
import { saveTripFields, tripFailure } from "./trip-edit";
import styles from "./TripDetails.module.css";

type Trip = TripDetailDTO["trip"];
type Props = {
  /** The trip, or null for a new one (New trip). */
  trip: Trip | null;
  /** The dated events' days, to count those a new date range leaves out (DASH-6). */
  itemDates?: string[];
  recentCurrencies: string[];
  open: boolean;
  /** Opens with the budget or the globe point ready to change. */
  focus?: "details" | "budget" | "globe";
  triggerSelector?: string | null;
  guardRef?: React.RefObject<(() => boolean) | null>;
  onClose: () => void;
  onExited: () => void;
};

/**
 * DASH-3, DASH-6, ATLAS-4: the trip's details in a side panel, shown and edited in one layout. The owner changes each
 * value where it is: the name, destination and budget save on their own; Dates, Time zone (after showing what it does)
 * and Globe point open in place with their own Save. Delete trip sits at the foot and asks for the trip's name. A new
 * trip uses the same layout with every section open and one Create trip button.
 */
export function TripDetails({ trip, itemDates = [], recentCurrencies, open, focus = "details", triggerSelector, guardRef, onClose, onExited }: Props) {
  const ref = useRef<HTMLElement>(null);
  const formId = useId();
  const titleId = useId();
  // The values and sections edited here (the name included): their saves in flight and unsaved changes.
  const edits = usePanelEdits();
  const leaving = useRef(false);
  // Read when a close is asked for, which can come before a re-render: a ref, not state.
  const newDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const isDirty = () => (trip ? edits.dirty() : newDirty.current);

  useEffect(() => {
    if (discard) ref.current?.querySelector<HTMLElement>("[data-discard-keep]")?.focus();
  }, [discard]);
  // Browser Back closes the panel at once when nothing is saving or unsaved; otherwise it goes the way the close button
  // does (TRIP-1).
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = () => {
      if (!edits.busy() && !isDirty()) return true;
      void requestClose();
      return false;
    };
    return () => {
      guardRef.current = null;
    };
  });

  // Saves in flight finish before closing, so one about to land is never offered for discarding; anything still
  // unsaved is asked about.
  async function requestClose() {
    if (busy || leaving.current) return;
    if (discard) { setDiscard(null); return; }
    leaving.current = true;
    if (edits.busy()) {
      setWaiting(true);
      await edits.settle();
      setWaiting(false);
    }
    leaving.current = false;
    if (isDirty()) setDiscard(() => onClose);
    else onClose();
  }

  const notice = waiting ? <p className={styles.waiting} role="status">Saving…</p> : discard ? (
    <PanelNotice actions={<><Button data-discard-keep variant="quiet" onClick={() => setDiscard(null)}>Keep editing</Button><Button variant="danger" onClick={() => { const go = discard; setDiscard(null); newDirty.current = false; go(); }}>Discard changes</Button></>}>
      You have unsaved changes. Discard them?
    </PanelNotice>
  ) : null;

  if (!trip) {
    return (
      <SidePanel
        open={open}
        onClose={() => void requestClose()}
        onExited={onExited}
        label="New trip"
        closeLabel="Close without creating"
        closeDisabled={busy}
        triggerSelector={triggerSelector}
        initialFocus={() => ref.current?.querySelector<HTMLElement>("#nt-title") ?? null}
        panelRef={ref}
        bar={<span className={styles.barTitle}>New trip</span>}
        notices={notice}
        footer={
          <>
            <Button variant="quiet" onClick={() => void requestClose()} disabled={busy}>Cancel</Button>
            <Button variant="fill" type="submit" form={formId} disabled={busy}>{busy ? "Creating…" : "Create trip"}</Button>
          </>
        }
      >
        <NewTrip formId={formId} recentCurrencies={recentCurrencies} onDirty={(dirty) => { newDirty.current = dirty; }} onBusy={setBusy} />
      </SidePanel>
    );
  }

  return (
    <PanelEdits.Provider value={edits}>
    <SidePanel
      open={open}
      onClose={() => void requestClose()}
      onExited={onExited}
      labelledBy={titleId}
      closeLabel="Close trip details"
      triggerSelector={triggerSelector}
      initialFocus={focus === "budget" ? () => ref.current?.querySelector<HTMLElement>("#td-budget") ?? null : focus === "globe" ? () => ref.current?.querySelector<HTMLElement>("#td-place") ?? null : undefined}
      panelRef={ref}
      bar={<span className={styles.barTitle}>Trip details</span>}
      notices={notice}
    >
      <header className={styles.head}>
        <p className={styles.eyebrow}>Trip</p>
        <TripTitleField tripId={trip.id} title={trip.title} canEdit as="h2" headingId={titleId} className={styles.title} />
        <DestinationField trip={trip} />
      </header>

      <DatesSection tripId={trip.id} dates={trip} dayCount={trip.dayCount} itemDates={itemDates} />
      <ZoneSection tripId={trip.id} zone={trip.timeZone} version={trip.version} />

      <SectionFrame title="Budget">
        <BudgetField trip={trip} recentCurrencies={recentCurrencies} startOpen={focus === "budget"} />
        <p className="note">Planned prices are compared with the budget only in its currency; other currencies are never converted.</p>
      </SectionFrame>

      <GlobePoint tripId={trip.id} point={trip.atlasLocation} setByYou={trip.primaryOwner} startOpen={focus === "globe"} />

      <section className={styles.danger} aria-labelledby={`${titleId}-danger`}>
        <h3 id={`${titleId}-danger`}>Delete this trip</h3>
        <p className="note">Removes the trip, its events and booking list, and revokes every invitation. This cannot be undone.</p>
        <div><Button variant="danger" data-delete-trip onClick={() => setDeleting(true)}>Delete trip…</Button></div>
      </section>

      {deleting ? <DeleteTripDialog trip={trip} onCancel={() => setDeleting(false)} /> : null}
    </SidePanel>
    </PanelEdits.Provider>
  );
}

/** The main destination, edited in place; a new one moves a globe point matched from the place list, never one set by hand. */
function DestinationField({ trip }: { trip: Trip }) {
  const router = useRouter();
  const field = useInlineField({
    read: () => trip.destination,
    save: async (next, start) => {
      const r = await saveTripFields(trip.id, { destination: next }, { destination: start });
      if (!r.ok) return tripFailure(r);
      router.refresh();
      return { ok: true, note: trip.atlasLocation?.source === "owner" ? "Saved. The globe point was set by hand, so check it below." : undefined };
    },
  });
  return (
    <InlineEdit
      label="Main destination"
      valueText={trip.destination}
      className={styles.dest}
      canEdit
      editing={field.editing}
      onEdit={field.open}
      onCommit={() => void field.commit()}
      onCancel={field.cancel}
      status={field.status}
      controls={({ describedBy }) => (
        <Field label="Main destination" htmlFor="td-destination" error={field.error("destination")} errorId="td-destination-err">
          <DestinationInput id="td-destination" value={field.draft} onChange={field.setDraft} onPick={(p) => field.setDraft(p.label)} invalid={!!field.error("destination")} describedBy={[field.error("destination") ? "td-destination-err" : null, describedBy].filter(Boolean).join(" ")} />
        </Field>
      )}
    >
      {trip.destination}
    </InlineEdit>
  );
}

/** The optional budget (BUDGET-2), edited in place; an empty amount removes it. */
function BudgetField({ trip, recentCurrencies, startOpen }: { trip: Trip; recentCurrencies: string[]; startOpen: boolean }) {
  const router = useRouter();
  const field = useInlineField({
    initiallyOpen: startOpen,
    read: () => ({ amount: trip.budget?.amount ?? "", currency: trip.budget?.currency ?? defaultCurrency(recentCurrencies) }),
    save: async (next, start) => {
      const money = (d: { amount: string; currency: string }): MoneyDTO | null => (d.amount.trim() ? { amount: d.amount.trim(), currency: d.currency } : null);
      const r = await saveTripFields(trip.id, { budget: money(next) }, { budget: money(start) });
      if (!r.ok) return tripFailure(r);
      router.refresh();
      return { ok: true, note: money(next) ? undefined : "Budget removed." };
    },
  });
  const b = trip.budget;
  return (
    <InlineEdit
      label="Budget"
      valueText={b ? formatMoney(b.amount, b.currency) : undefined}
      placeholder="Add a budget"
      empty={!b}
      canEdit
      editing={field.editing}
      onEdit={field.open}
      onCommit={() => void field.commit()}
      onCancel={field.cancel}
      status={field.status}
      controls={({ describedBy }) => (
        <Field label="Budget" htmlFor="td-budget" error={field.error("budget")} errorId="td-budget-err">
          <MoneyInput
            amountId="td-budget"
            currencyId="td-budgetCurrency"
            amount={field.draft.amount}
            currency={field.draft.currency}
            onAmount={(amount) => field.setDraft((d) => ({ ...d, amount }))}
            onCurrency={(currency) => field.setDraft((d) => ({ ...d, currency }))}
            recent={recentCurrencies}
            currencyLabel="Budget currency"
            placeholder="3500"
            invalid={!!field.error("budget")}
            describedBy={[field.error("budget") ? "td-budget-err" : null, describedBy].filter(Boolean).join(" ")}
          />
        </Field>
      )}
    >
      {b ? formatMoney(b.amount, b.currency) : ""}
    </InlineEdit>
  );
}
