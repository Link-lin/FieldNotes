import { route } from "@/server/core/http/route";
import { updateItemNotes } from "@/server/modules/items/items.service";
import { itemNotesSchema } from "@/shared/schemas";

/** TRIP-10: save an event's notes from its side panel. */
export const PATCH = route<{ tripId: string; itemId: string }, typeof itemNotesSchema>({ body: itemNotesSchema }, ({ db, actor, params, body }) =>
  updateItemNotes(db, actor, params.tripId, params.itemId, body),
);
