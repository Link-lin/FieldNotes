import "server-only";
import { cache } from "react";
import type { Kysely } from "kysely";
import { getDb } from "@/server/core/db/client";
import type { DB } from "@/server/core/db/schema";
import { conflict } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";
import { requireOwnerAccount, requireTripOwner, requireTripRead } from "@/server/auth/access";
import { compareItems, itemDto } from "@/server/modules/items/items.mapper";
import { liveItems } from "@/server/modules/items/items.repository";
import { matchDestination } from "@/server/modules/places/catalog";
import type { TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { trimAmount } from "@/shared/money";
import type { TripInput, TripPatch } from "@/shared/schemas";
import { dateInZone } from "@/shared/time";
import { budgetComparison, plannedTotals, recentCurrencies } from "./budget.repository";
import { applyTimeZoneChange } from "./time-zone.service";
import { countUsage } from "@/server/modules/usage/usage.service";
import { tripSummary } from "./trips.mapper";
import { deleteTripRow, insertTrip, updateTripRow } from "./trips.repository";

/** A trip page: the trip, its live items in timeline order, money totals and budget comparison. */
export async function getTripDetail(db: Kysely<DB>, actor: Actor, tripId: string, now = new Date()): Promise<TripDetailDTO> {
  const { trip, role } = await requireTripRead(db, actor, tripId);
  const today = dateInZone(trip.time_zone, now.getTime());
  const items = (await liveItems(db, trip.id)).map((r) => itemDto(r, trip.time_zone, today)).sort(compareItems);
  return {
    trip: {
      ...tripSummary(trip, role, now),
      version: trip.version,
      budget: trip.budget_amount !== null && trip.budget_currency ? { amount: trimAmount(trip.budget_amount), currency: trip.budget_currency } : null,
      today,
    },
    items,
    plannedTotals: await plannedTotals(db, trip.id),
    budgetComparison: await budgetComparison(db, trip.id),
    recentCurrencies: role === "owner" ? await recentCurrencies(db, actor.userId) : [],
  };
}

/**
 * The trip page's data, read once per server render: the page and its metadata share it.
 * Pass the Actor from currentActor/pageActor, which is one object per render.
 */
export const tripDetailForPage = cache((actor: Actor, tripId: string) => getTripDetail(getDb(), actor, tripId));

/** DASH-3: only allowlisted owners create trips; the destination is matched to the place catalog. */
export async function createTrip(db: Kysely<DB>, actor: Actor, input: TripInput, now = new Date()): Promise<TripSummaryDTO> {
  requireOwnerAccount(actor);
  const point = matchDestination(input.destination);
  const row = await insertTrip(db, actor.userId, {
    title: input.title,
    destination: input.destination,
    start_date: input.startDate,
    end_date: input.endDate,
    time_zone: input.timeZone,
    budget_amount: input.budget?.amount ?? null,
    budget_currency: input.budget?.currency ?? null,
    atlas_latitude: point ? String(point.latitude) : null,
    atlas_longitude: point ? String(point.longitude) : null,
    atlas_source: point ? "catalog" : null,
  });
  await countUsage(db, [{ name: "manual_trip_created" }]);
  return tripSummary(row, "owner", now);
}

/** DASH-6: edit a trip; a time-zone change needs confirmation, a destination change re-matches the globe point. */
export async function updateTrip(db: Kysely<DB>, actor: Actor, tripId: string, patch: TripPatch, now = new Date()): Promise<TripSummaryDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (trip.version !== patch.expectedVersion) throw conflict();
    if (patch.timeZone !== trip.time_zone) await applyTimeZoneChange(tx, trip, patch.timeZone, patch.confirmTimeZoneImpact, patch.timeDisambiguationByItem ?? {});

    // Globe point (ATLAS-4, ATLAS-5): an explicit edit wins; otherwise a new destination re-matches a catalog point.
    let lat = trip.atlas_latitude;
    let lon = trip.atlas_longitude;
    let src = trip.atlas_source;
    if (patch.atlasLocation !== undefined) {
      if (patch.atlasLocation === null) [lat, lon, src] = [null, null, null];
      else [lat, lon, src] = [patch.atlasLocation.latitude.toFixed(5), patch.atlasLocation.longitude.toFixed(5), "owner"];
    } else if (patch.destination !== trip.destination && src !== "owner") {
      const p = matchDestination(patch.destination);
      [lat, lon, src] = p ? [String(p.latitude), String(p.longitude), "catalog"] : [null, null, null];
    }

    const row = await updateTripRow(tx, trip.id, patch.expectedVersion, {
      title: patch.title,
      destination: patch.destination,
      start_date: patch.startDate,
      end_date: patch.endDate,
      time_zone: patch.timeZone,
      budget_amount: patch.budget?.amount ?? null,
      budget_currency: patch.budget?.currency ?? null,
      atlas_latitude: lat,
      atlas_longitude: lon,
      atlas_source: src,
    });
    if (!row) throw conflict();
    return tripSummary(row, "owner", now);
  });
}

/** TRIP-5: permanent deletion with its items and shares. */
export async function deleteTrip(db: Kysely<DB>, actor: Actor, tripId: string, expectedVersion: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (trip.version !== expectedVersion) throw conflict();
    await deleteTripRow(tx, trip.id);
  });
}
