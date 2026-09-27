import { handle, HttpError, json } from "@/server/http";
import { requireActor } from "@/server/session";
import { requireOwnerAccount } from "@/server/access";
import { searchPlaces } from "@/server/catalog";

/** Bundled catalog search for the owner's globe-point editor; no external geocoder. */
export async function GET(req: Request) {
  return handle(async () => {
    requireOwnerAccount(await requireActor());
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (q.length < 2 || q.length > 160) throw new HttpError(422, "validation_error", "Type 2 to 160 characters.");
    return json({ places: searchPlaces(q) });
  });
}
