"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast/Toast";
import { replaceEventReturn, takeEventReturn } from "@/lib/event-return";
import { useLiveRevision } from "@/lib/use-live-revision";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { tripRevision } from "@/shared/revision";
import { canEdit } from "@/shared/roles";
import { EventPanel } from "../TripPage/EventPanel/EventPanel";
import { REVIEW_CHANGED, sendReview } from "../TripPage/review-events";
import { tripDays, tripStops } from "../TripPage/trip-days";

type Props = { data: TripDetailDTO; itemId: string; selectedDay: string | null; fromBookings: boolean; initialEditing: boolean; mapsKey: string | null };

/** The same event details/editor used by the desktop panel, with a real URL and Back on phones. */
export function EventPage({ data, itemId, selectedDay, fromBookings, initialEditing, mapsKey }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { trip, items } = data;
  // TRIP-11: the event follows changes made elsewhere; if it is deleted, the refresh shows that it is gone.
  useLiveRevision(`/api/trips/${trip.id}/revision`, tripRevision(trip));
  const [saved, setSaved] = useState<PlanItemDTO | null>(null);
  const original = items.find((item) => item.id === itemId)!;
  const item = saved && saved.version > original.version ? saved : original;
  const { byDate, days } = tripDays(trip, items);
  const day = selectedDay && days.includes(selectedDay) ? selectedDay : "all";
  const shown = fromBookings ? items.filter((event) => event.bookingStatus === "needs_booking").sort((a, b) => (a.bookingDueDate ?? "9999").localeCompare(b.bookingDueDate ?? "9999")) : [
    ...(day === "all" ? days : [day]).flatMap((date) => {
      const list = byDate.get(date) ?? [];
      return [...list.filter((event) => event.sortInstant), ...list.filter((event) => !event.sortInstant)];
    }),
    ...(day === "all" ? items.filter((event) => !event.timelineDate && event.flightDetails) : []),
    ...(day === "all" ? items.filter((event) => !event.timelineDate && !event.flightDetails) : []),
  ];
  const at = shown.findIndex((event) => event.id === itemId);
  const numbers = new Map(tripStops(trip, byDate, days).map((stop) => [stop.id, { n: stop.n, need: stop.need }]));
  const lastPriced = [...items].filter((event) => event.plannedPrice).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1)[0];
  const defaultCurrency = lastPriced?.plannedPrice?.currency ?? trip.budget?.currency ?? data.recentCurrencies[0] ?? "USD";
  const query = fromBookings ? "?view=bookings" : day === "all" ? "" : `?day=${encodeURIComponent(day)}`;
  const back = `/trips/${trip.id}${query}`;
  const eventUrl = (target: PlanItemDTO) => `/trips/${trip.id}/items/${target.id}${query}`;

  return (
    <EventPanel
      presentation="page"
      trip={trip}
      item={item}
      open
      canEdit={canEdit(trip.role)}
      num={numbers.get(item.id) ?? null}
      mapsKey={mapsKey}
      defaultCurrency={defaultCurrency}
      recentCurrencies={data.recentCurrencies}
      initialEditing={initialEditing}
      prev={at > 0 ? shown[at - 1] ?? null : null}
      next={at >= 0 ? shown[at + 1] ?? null : null}
      onGo={(target) => { replaceEventReturn(trip.id, target.id); router.replace(eventUrl(target)); }}
      onClose={() => { if (takeEventReturn(trip.id, item.id)) router.back(); else router.replace(back); }}
      onExited={() => {}}
      onSaved={(updated) => { setSaved(updated); router.refresh(); toast({ message: "Event updated." }); }}
      onNotesSaved={(updated) => { setSaved(updated); router.refresh(); }}
      onReview={canEdit(trip.role) ? async (target, reviewed) => {
        const r = await sendReview(trip.id, [target], reviewed);
        router.refresh();
        if (!r.ok) {
          toast({ message: r.status === 409 ? REVIEW_CHANGED : r.message });
          return null;
        }
        setSaved(r.data[0]!);
        return r.data[0]!;
      } : undefined}
    />
  );
}
