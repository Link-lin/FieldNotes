import { route } from "@/server/core/http/route";
import { readForm } from "@/server/core/http/request";
import { coverParts, readTripCover, removeTripCover, setTripCover } from "@/server/modules/covers/cover.service";
import { coverRemoveSchema } from "@/shared/schemas";

type P = { tripId: string };

/** DASH-8: one of the trip's cover images: `small` (cards and the header) unless `size=full` (the full-size view). */
export const GET = route<P>({}, async ({ db, actor, params, req }) => {
  const size = new URL(req.url).searchParams.get("size") === "full" ? "full" : "small";
  const bytes = await readTripCover(db, actor, params.tripId, size);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Content-Disposition": "inline", "Cache-Control": "private, no-store" },
  });
});

/** DASH-8: adds or replaces the cover; the browser sends both sizes and the cover it replaces. */
export const PUT = route<P>({}, async ({ db, actor, params, req }) => setTripCover(db, actor, params.tripId, await coverParts(await readForm(req))));

/** DASH-8: removes the cover. */
export const DELETE = route<P, typeof coverRemoveSchema>({ body: coverRemoveSchema }, ({ db, actor, params, body }) => removeTripCover(db, actor, params.tripId, body.base));
