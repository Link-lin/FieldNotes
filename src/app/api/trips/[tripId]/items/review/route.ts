import { route } from "@/server/core/http/route";
import { reviewItems } from "@/server/modules/items/items.service";
import { itemReviewSchema } from "@/shared/schemas";

/** IMPORT-7: mark AI drafts reviewed, one event or many (or undo that). */
export const POST = route<{ tripId: string }, typeof itemReviewSchema>({ body: itemReviewSchema }, ({ db, actor, params, body }) =>
  reviewItems(db, actor, params.tripId, body),
);
