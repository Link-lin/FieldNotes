import { route } from "@/server/core/http/route";
import { createItem } from "@/server/modules/items/items.service";
import { itemInputSchema } from "@/shared/schemas";

/** TRIP-9: add an event. */
export const POST = route<{ tripId: string }, typeof itemInputSchema>({ body: itemInputSchema, status: 201 }, ({ db, actor, params, body }) =>
  createItem(db, actor, params.tripId, body),
);
