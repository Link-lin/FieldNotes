import "server-only";
import { cache } from "react";
import type { Kysely } from "kysely";
import { getDb } from "@/server/core/db/client";
import type { Tx } from "@/server/core/db/client";
import type { DB, TripRow } from "@/server/core/db/schema";
import { conflict, fieldConflict, invalid } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";
import { requireOwnerAccount, requireTripOwner, requireTripRead, type TripAccess } from "@/server/auth/access";
import { compareItems, itemDto } from "@/server/modules/items/items.mapper";
import { liveItems } from "@/server/modules/items/items.repository";
import { matchDestination } from "@/server/modules/places/catalog";
import type { TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { trimAmount } from "@/shared/money";
import { tripRevision } from "@/shared/revision";
import { mergeFields, tripFieldsOf, type TripFields } from "@/shared/fields";
import { toFieldErrors, tripFieldsSchema, type TripFieldsPatch, type TripInput, type TripPatch } from "@/shared/schemas";
import { dateInZone } from "@/shared/time";
import { budgetComparison, plannedTotals, recentCurrencies } from "./budget.repository";
import { applyTimeZoneChange } from "./time-zone.service";
import { countUsage } from "@/server/modules/usage/usage.service";
import { tripSummary } from "./trips.mapper";
import { deleteTripRow, insertTrip, updateTripRow } from "./trips.repository";

/** A trip page: the trip, its live items in timeline order, money totals and budget comparison. */
export async function getTripDetail(db: Kysely<DB>, actor: Actor, tripId: string, now = new Date()): Promise<TripDetailDTO> {
  const access = await requireTripRead(db, actor, tripId);
  const { trip, role } = access;
  const today = dateInZone(trip.time_zone, now.getTime());
  const items = (await liveItems(db, trip.id)).map((r) => itemDto(r, trip.time_zone, today)).sort(compareItems);
  return {
    trip: {
      ...tripSummary(trip, access, now),
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
 * Live updates (TRIP-11): the revision of the trip page, which the open page asks for every few seconds. Any role that can
 * read the trip; anyone else gets the same 404 as for the trip itself.
 */
export async function getTripRevision(db: Kysely<DB>, actor: Actor, tripId: string): Promise<{ revision: string }> {
  const { trip, role } = await requireTripRead(db, actor, tripId);
  return { revision: tripRevision({ version: trip.version, role }) };
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
  return tripSummary(row, { role: "owner", primaryOwner: true }, now);
}

/** DASH-6: edit a trip; a time-zone change needs confirmation, a destination change re-matches the globe point. */
export async function updateTrip(db: Kysely<DB>, actor: Actor, tripId: string, patch: TripPatch, now = new Date()): Promise<TripSummaryDTO> {
  return db.transaction().execute(async (tx) => {
    const access = await requireTripOwner(tx, actor, tripId, true);
    if (access.trip.version !== patch.expectedVersion) throw conflict();
    return writeTrip(tx, access, { ...patch, atlasLocation: patch.atlasLocation ?? null }, patch.atlasLocation !== undefined, patch, now);
  });
}

/**
 * DASH-6, ATLAS-4: change some of a trip's fields from the trip page. Each changed field must still hold the value it had
 * when the edit began, so a change elsewhere to another field (or to the trip's events, which also moves its version) is
 * no clash. The merged trip passes the same checks as a full edit, and a time-zone change still needs its impact confirmed.
 */
export async function updateTripFields(db: Kysely<DB>, actor: Actor, tripId: string, body: TripFieldsPatch, now = new Date()): Promise<TripSummaryDTO> {
  return db.transaction().execute(async (tx) => {
    const access = await requireTripOwner(tx, actor, tripId, true);
    const { merged, conflicts } = mergeFields(tripFieldsOfRow(access.trip), body.changes, body.base);
    if (conflicts.length) throw fieldConflict(conflicts);
    const parsed = tripFieldsSchema.safeParse(merged);
    if (!parsed.success) throw invalid(toFieldErrors(parsed.error));
    return writeTrip(tx, access, parsed.data, "atlasLocation" in body.changes, body, now);
  });
}

/** A trip's editable fields as stored, in the shape the trip page edits (`tripFieldsOf`). */
function tripFieldsOfRow(trip: TripRow): TripFields {
  return tripFieldsOf({
    title: trip.title,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    timeZone: trip.time_zone,
    budget: trip.budget_amount !== null && trip.budget_currency ? { amount: trimAmount(trip.budget_amount), currency: trip.budget_currency } : null,
    atlasLocation: trip.atlas_latitude !== null && trip.atlas_longitude !== null && trip.atlas_source ? { latitude: Number(trip.atlas_latitude), longitude: Number(trip.atlas_longitude) } : null,
  });
}

/** The checks and write a trip edit shares, full or field-level. `pointSet` says the globe point was edited explicitly. */
async function writeTrip(
  tx: Tx,
  access: TripAccess,
  next: TripFields,
  pointSet: boolean,
  zone: { confirmTimeZoneImpact?: boolean; timeDisambiguationByItem?: Record<string, "earlier" | "later"> },
  now: Date,
): Promise<TripSummaryDTO> {
  const { trip } = access;
  if (next.timeZone !== trip.time_zone) await applyTimeZoneChange(tx, trip, next.timeZone, zone.confirmTimeZoneImpact, zone.timeDisambiguationByItem ?? {});

  // Globe point (ATLAS-4, ATLAS-5): an explicit edit wins; otherwise a new destination re-matches a catalog point.
  let lat = trip.atlas_latitude;
  let lon = trip.atlas_longitude;
  let src = trip.atlas_source;
  if (pointSet) {
    if (next.atlasLocation === null) [lat, lon, src] = [null, null, null];
    else [lat, lon, src] = [next.atlasLocation.latitude.toFixed(5), next.atlasLocation.longitude.toFixed(5), "owner"];
  } else if (next.destination !== trip.destination && src !== "owner") {
    const p = matchDestination(next.destination);
    [lat, lon, src] = p ? [String(p.latitude), String(p.longitude), "catalog"] : [null, null, null];
  }

  const row = await updateTripRow(tx, trip.id, trip.version, {
    title: next.title,
    destination: next.destination,
    start_date: next.startDate,
    end_date: next.endDate,
    time_zone: next.timeZone,
    budget_amount: next.budget?.amount ?? null,
    budget_currency: next.budget?.currency ?? null,
    atlas_latitude: lat,
    atlas_longitude: lon,
    atlas_source: src,
  });
  if (!row) throw conflict();
  return tripSummary({ ...row, owner_name: trip.owner_name }, access, now);
}

/** TRIP-5: permanent deletion with its items and shares. */
export async function deleteTrip(db: Kysely<DB>, actor: Actor, tripId: string, expectedVersion: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (trip.version !== expectedVersion) throw conflict();
    await deleteTripRow(tx, trip.id);
  });
}
