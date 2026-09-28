import { notFound } from "next/navigation";
import { getDb } from "@/server/core/db/client";
import { HttpError } from "@/server/core/http/errors";
import { mapsEmbedKey } from "@/server/core/env";
import { currentActor, pageActor } from "@/server/auth/session";
import { getTripDetail } from "@/server/modules/trips/trips.service";
import { TripPage } from "@/features/trips/TripPage/TripPage";

type Props = { params: Promise<{ tripId: string }>; searchParams: Promise<{ day?: string }> };

export default async function TripRoute({ params, searchParams }: Props) {
  const { tripId } = await params;
  const actor = await pageActor(`/trips/${encodeURIComponent(tripId)}`);
  const { day } = await searchParams;
  const data = await getTripDetail(getDb(), actor, tripId).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  return <TripPage key={tripId} data={data} initialDay={day ?? null} mapsKey={mapsEmbedKey()} />;
}

export async function generateMetadata({ params }: Props) {
  const actor = await currentActor();
  if (!actor) return { title: "Field Notes" };
  try {
    const data = await getTripDetail(getDb(), actor, (await params).tripId);
    return { title: `${data.trip.title} | Field Notes` };
  } catch {
    return { title: "Trip | Field Notes" };
  }
}
