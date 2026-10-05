import { notFound } from "next/navigation";
import { HttpError } from "@/server/core/http/errors";
import { mapsEmbedKey } from "@/server/core/env";
import { pageActor } from "@/server/auth/session";
import { placeLookupConfigured } from "@/server/modules/places/geocode.service";
import { tripDetailForPage } from "@/server/modules/trips/trips.service";
import { EventPage } from "@/features/trips/EventPage/EventPage";

type Props = { params: Promise<{ tripId: string; itemId: string }>; searchParams: Promise<{ day?: string; edit?: string; view?: string }> };

/** A phone-sized, deep-linkable event page. The trip read check also covers invited viewers. */
export default async function EventRoute({ params, searchParams }: Props) {
  const { tripId, itemId } = await params;
  const actor = await pageActor();
  const data = await tripDetailForPage(actor, tripId).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  if (!data.items.some((item) => item.id === itemId)) notFound();
  const query = await searchParams;
  return <EventPage key={itemId} data={data} itemId={itemId} selectedDay={query.day ?? null} fromBookings={query.view === "bookings"} focusTitle={query.edit === "1"} mapsKey={mapsEmbedKey()} placeLookup={placeLookupConfigured()} />;
}
