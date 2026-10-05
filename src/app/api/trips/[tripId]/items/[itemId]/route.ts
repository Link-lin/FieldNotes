import { route } from "@/server/core/http/route";
import { later } from "@/server/core/later";
import { deleteItem, updateItem } from "@/server/modules/items/items.service";
import { itemPatchSchema, versionSchema } from "@/shared/schemas";

type P = { tripId: string; itemId: string };

/** TRIP-9: edit an event (a new place name is pinned afterwards when the lookup finds a clear match, MAP-2). */
export const PATCH = route<P, typeof itemPatchSchema>({ body: itemPatchSchema }, ({ db, actor, params, body }) => updateItem(db, actor, params.tripId, params.itemId, body, undefined, later));

/** TRIP-8: delete an event (restorable for 10 minutes). */
export const DELETE = route<P, typeof versionSchema>({ body: versionSchema }, ({ db, actor, params, body }) => deleteItem(db, actor, params.tripId, params.itemId, body.expectedVersion));
