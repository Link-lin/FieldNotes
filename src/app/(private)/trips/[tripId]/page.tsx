import { notFound } from "next/navigation";
import { HttpError } from "@/server/core/http/errors";
import { mapsEmbedKey } from "@/server/core/env";
import { mailConfigured } from "@/server/core/mail";
import { placeLookupConfigured } from "@/server/modules/places/geocode.service";
import { currentActor, pageActor } from "@/server/auth/session";
import { tripDetailForPage } from "@/server/modules/trips/trips.service";
import { TripPage } from "@/features/trips/TripPage/TripPage";
import { panelFromParams } from "@/features/trips/TripPage/panel-request";

type Props = { params: Promise<{ tripId: string }>; searchParams: Promise<{ day?: string; event?: string; add?: string; trip?: string; share?: string; view?: string }> };

export default async function TripRoute({ params, searchParams }: Props) {
  const { tripId } = await params;
  const actor = await pageActor();
  const { day, view, ...panel } = await searchParams;
  const data = await tripDetailForPage(actor, tripId).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  return <TripPage key={tripId} data={data} initialDay={day ?? null} initialPanel={panelFromParams(panel)} initialView={view === "bookings" ? "bookings" : "itinerary"} mapsKey={mapsEmbedKey()} canEmail={mailConfigured()} placeLookup={placeLookupConfigured()} />;
}

export async function generateMetadata({ params }: Props) {
  const actor = await currentActor();
  if (!actor) return { title: "Field Notes" };
  try {
    const data = await tripDetailForPage(actor, (await params).tripId);
    return { title: `${data.trip.title} | Field Notes` };
  } catch {
    return { title: "Trip | Field Notes" };
  }
}
