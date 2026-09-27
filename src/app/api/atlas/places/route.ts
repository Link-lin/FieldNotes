import { HttpError } from "@/server/core/http/errors";
import { route } from "@/server/core/http/route";
import { searchPlaces } from "@/server/modules/places/catalog";

/** Bundled place search for the trip form and the globe-point editor (owners only); no external geocoder. */
export const GET = route({ ownerAccount: true }, async ({ req }) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length < 2 || q.length > 160) throw new HttpError(422, "validation_error", "Type 2 to 160 characters.");
  return { places: searchPlaces(q) };
});
