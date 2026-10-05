import { route } from "@/server/core/http/route";
import { getTripRevision } from "@/server/modules/trips/trips.service";

/** TRIP-11: the open trip page asks every few seconds whether the trip changed. */
export const GET = route<{ tripId: string }>({}, ({ db, actor, params }) => getTripRevision(db, actor, params.tripId));
