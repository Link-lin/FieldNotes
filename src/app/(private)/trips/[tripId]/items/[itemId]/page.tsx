import { notFound } from "next/navigation";
import { getDb } from "@/server/core/db/client";
import { HttpError } from "@/server/core/http/errors";
import { mapsEmbedKey } from "@/server/core/env";
import { pageActor } from "@/server/auth/session";
import { getTripDetail } from "@/server/modules/trips/trips.service";
import { EventPage } from "@/features/trips/EventPage/EventPage";

type Props = { params: Promise<{ tripId: string; itemId: string }>; searchParams: Promise<{ day?: string; edit?: string; view?: string }> };

/** A phone-sized, deep-linkable event page. The trip read check also covers invited viewers. */
export default async function EventRoute({ params, searchParams }: Props) {
  const { tripId, itemId } = await params;
  const actor = await pageActor(`/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`);
  const data = await getTripDetail(getDb(), actor, tripId).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  if (!data.items.some((item) => item.id === itemId)) notFound();
  const query = await searchParams;
  return <EventPage key={itemId} data={data} itemId={itemId} selectedDay={query.day ?? null} fromBookings={query.view === "bookings"} initialEditing={query.edit === "1"} mapsKey={mapsEmbedKey()} />;
}
