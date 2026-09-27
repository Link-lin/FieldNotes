import { route } from "@/server/core/http/route";
import { restoreItem } from "@/server/modules/items/items.service";

/** TRIP-8: undo a delete within 10 minutes. */
export const POST = route<{ tripId: string; itemId: string }>({}, ({ db, actor, params }) => restoreItem(db, actor, params.tripId, params.itemId));
