import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { errorTag } from "@/server/core/http/respond";
import { bumpTripVersion } from "@/server/modules/trips/trips.repository";
import type { PlanItemDTO } from "@/shared/dto";
import type { ImportLocationResult } from "@/shared/import";
import { openStreetMapPointUrl } from "@/shared/map-links";
import { findPlaceCandidates, placeLookupConfigured } from "./geocode.service";

/** Automatic lookups start at most this often, under Geoapify's free-plan rate of five a second. */
const SPACING_MS = 250;
let nextSlot = 0;
async function pace(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + SPACING_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

/** Whether an event gets an automatic pin: it has a place name and no map link yet, and isn't a flight (airports pin those). */
export const wantsAutoPin = (item: Pick<PlanItemDTO, "type" | "location" | "mapUrl">): boolean => item.type !== "flight" && !!item.location?.trim() && !item.mapUrl;

/**
 * MAP-2: looks up these events' place names and pins each one whose lookup finds a single clear match, the match the
 * import preview would choose for the owner. Runs after the response, so nobody waits for it. An event changed in the
 * meantime (renamed, given a map link or deleted) is left alone; a failed lookup leaves it unpinned, and Find place on map
 * still works. Each pin is its own small write, so pins appear one by one on an open page (TRIP-11). Returns how many.
 */
export async function autoPin(db: Kysely<DB>, tripId: string, itemIds: string[], find = findPlaceCandidates): Promise<number> {
  if (!itemIds.length || !placeLookupConfigured()) return 0;
  try {
    const trip = await db.selectFrom("trips").select(["destination"]).where("id", "=", tripId).executeTakeFirst();
    if (!trip) return 0;
    const rows = await db.selectFrom("plan_items").select(["id", "type", "location", "map_url"]).where("trip_id", "=", tripId).where("id", "in", itemIds).where("deleted_at", "is", null).execute();
    // One lookup per place name: a chat often adds the same place twice.
    const lookups = new Map<string, Promise<ImportLocationResult | null>>();
    let pinned = 0;
    for (const row of rows) {
      const place = row.location?.trim();
      if (row.type === "flight" || !place || row.map_url) continue;
      if (!lookups.has(place)) lookups.set(place, find(place, trip.destination, { pace }).catch(() => null));
      const result = await lookups.get(place)!;
      const match = result && result.suggestedIndex !== null ? result.candidates[result.suggestedIndex] : undefined;
      if (!match) continue;
      const done = await db.transaction().execute(async (tx) => {
        await tx.selectFrom("trips").select("id").where("id", "=", tripId).forUpdate().executeTakeFirst();
        const now = await tx.selectFrom("plan_items").select(["location", "map_url"]).where("id", "=", row.id).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
        if (!now || now.map_url || now.location?.trim() !== place) return false;
        await tx
          .updateTable("plan_items")
          .set({ map_url: openStreetMapPointUrl(match.latitude, match.longitude), latitude: match.latitude.toFixed(5), longitude: match.longitude.toFixed(5), pin_source: "lookup", version: sql`version + 1`, updated_at: sql`now()` })
          .where("id", "=", row.id)
          .execute();
        await bumpTripVersion(tx, tripId);
        return true;
      });
      if (done) pinned += 1;
    }
    return pinned;
  } catch (err) {
    console.error(`[auto-pin] ${errorTag(err)}`);
    return 0;
  }
}
