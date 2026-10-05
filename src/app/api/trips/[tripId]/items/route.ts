import { route } from "@/server/core/http/route";
import { later } from "@/server/core/later";
import { createItem } from "@/server/modules/items/items.service";
import { itemInputSchema } from "@/shared/schemas";

/** TRIP-9: add an event (its place is pinned afterwards when the lookup finds a clear match, MAP-2). */
export const POST = route<{ tripId: string }, typeof itemInputSchema>({ body: itemInputSchema, status: 201 }, ({ db, actor, params, body }) =>
  createItem(db, actor, params.tripId, body, undefined, later),
);
