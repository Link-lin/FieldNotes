import { route } from "@/server/core/http/route";
import { duplicateItem } from "@/server/modules/items/items.service";
import { versionSchema } from "@/shared/schemas";

/** PLAN-3: copy an event. */
export const POST = route<{ tripId: string; itemId: string }, typeof versionSchema>({ body: versionSchema, status: 201 }, ({ db, actor, params, body }) =>
  duplicateItem(db, actor, params.tripId, params.itemId, body.expectedVersion),
);
