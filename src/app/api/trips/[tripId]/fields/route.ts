import { route } from "@/server/core/http/route";
import { updateTripFields } from "@/server/modules/trips/trips.service";
import { tripFieldsPatchSchema } from "@/shared/schemas";

/** DASH-6, ATLAS-4: change some of a trip's fields where the trip details show them. */
export const PATCH = route<{ tripId: string }, typeof tripFieldsPatchSchema>({ body: tripFieldsPatchSchema }, ({ db, actor, params, body }) =>
  updateTripFields(db, actor, params.tripId, body),
);
