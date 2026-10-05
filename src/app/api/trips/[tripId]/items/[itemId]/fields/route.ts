import { route } from "@/server/core/http/route";
import { later } from "@/server/core/later";
import { updateItemFields } from "@/server/modules/items/items.service";
import { itemFieldsPatchSchema } from "@/shared/schemas";

/** TRIP-10: change some of an event's fields where the event view shows them (a new place name is pinned afterwards, MAP-2). */
export const PATCH = route<{ tripId: string; itemId: string }, typeof itemFieldsPatchSchema>({ body: itemFieldsPatchSchema }, ({ db, actor, params, body }) =>
  updateItemFields(db, actor, params.tripId, params.itemId, body, undefined, later),
);
