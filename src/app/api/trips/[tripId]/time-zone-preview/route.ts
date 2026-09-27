import { route } from "@/server/core/http/route";
import { previewTimeZone } from "@/server/modules/trips/time-zone.service";
import { timeZonePreviewSchema } from "@/shared/schemas";

/** TRIP-4: what a trip time-zone change would do, without changing anything. */
export const POST = route<{ tripId: string }, typeof timeZonePreviewSchema>({ body: timeZonePreviewSchema }, ({ db, actor, params, body }) =>
  previewTimeZone(db, actor, params.tripId, body.timeZone, body.expectedVersion),
);
