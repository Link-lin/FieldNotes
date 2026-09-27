import { route } from "@/server/core/http/route";
import { deleteTrip, getTripDetail, updateTrip } from "@/server/modules/trips/trips.service";
import { tripDeleteSchema, tripPatchSchema } from "@/shared/schemas";

type P = { tripId: string };

export const GET = route<P>({}, ({ db, actor, params }) => getTripDetail(db, actor, params.tripId));

export const PATCH = route<P, typeof tripPatchSchema>({ body: tripPatchSchema }, ({ db, actor, params, body }) => updateTrip(db, actor, params.tripId, body));

export const DELETE = route<P, typeof tripDeleteSchema>({ body: tripDeleteSchema }, ({ db, actor, params, body }) => deleteTrip(db, actor, params.tripId, body.expectedVersion));
