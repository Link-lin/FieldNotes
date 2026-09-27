import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "./db-schema";
import type { Actor } from "./actor";
import { requireOwnerAccount, requireTripOwner, requireTripRead } from "./access";
import { compareItems, itemDto, tripSummary } from "./mapping";
import { conflict, HttpError, invalid } from "./http";
import { matchDestination } from "./catalog";
import { dateInZone, dueState, resolveLocal } from "@/shared/time";
import type { TripInput, TripPatch } from "@/shared/schemas";
import type { BookingTaskDTO, BudgetComparisonDTO, DashboardDTO, FieldError, PlannedTotalDTO, TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { trimAmount } from "@/shared/money";

/** Owned trips (owner still allowlisted) plus trips with an accepted grant for this user. */
export async function getDashboard(db: Kysely<DB>, actor: Actor, now = new Date()): Promise<DashboardDTO> {
  const rows = await db
    .selectFrom("trips")
    .innerJoin("User", "User.id", "trips.owner_user_id")
    .selectAll("trips")
    .select("User.name as owner_name")
    .where((eb) =>
      eb.or([
        eb.and([eb("trips.owner_user_id", "=", actor.userId), eb.val(actor.isOwner)]),
        eb.exists(
          eb
            .selectFrom("trip_viewers")
            .select("trip_viewers.id")
            .whereRef("trip_viewers.trip_id", "=", "trips.id")
            .where("trip_viewers.viewer_user_id", "=", actor.userId)
            .where("trip_viewers.status", "=", "accepted"),
        ),
      ]),
    )
    .orderBy("trips.start_date")
    .execute();

  const trips = rows.map((r) => tripSummary(r, r.owner_user_id === actor.userId && actor.isOwner ? "owner" : "viewer", now));
  const owned = rows.filter((r) => r.owner_user_id === actor.userId && actor.isOwner);
  let ownerBookingTasks: BookingTaskDTO[] = [];
  if (owned.length) {
    const byId = new Map(owned.map((r) => [r.id, r]));
    const items = await db
      .selectFrom("plan_items")
      .select(["id", "trip_id", "title", "booking_due_date"])
      .where("trip_id", "in", owned.map((r) => r.id))
      .where("booking_status", "=", "needs_booking")
      .where("deleted_at", "is", null)
      .execute();
    ownerBookingTasks = items
      .map((i) => {
        const trip = byId.get(i.trip_id)!;
        const today = dateInZone(trip.time_zone, now.getTime());
        return {
          tripId: trip.id,
          tripTitle: trip.title,
          itemId: i.id,
          itemTitle: i.title,
          dueDate: i.booking_due_date,
          state: i.booking_due_date ? dueState(i.booking_due_date, today) : ("no_due_date" as const),
        };
      })
      .sort((a, b) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : (a.dueDate ?? "9999") > (b.dueDate ?? "9999") ? 1 : 0);
  }
  return { canCreateTrips: actor.isOwner, trips, ownerBookingTasks };
}

async function totals(db: Kysely<DB>, tripId: string): Promise<PlannedTotalDTO[]> {
  const rows = await sql<{ currency: string; type: string | null; amount: string; n: number; unv: number }>`
    select planned_currency as currency, type, sum(planned_amount)::text as amount,
           count(*)::int as n, (count(*) filter (where price_source = 'ai'))::int as unv
    from plan_items
    where trip_id = ${tripId} and deleted_at is null and planned_amount is not null
    group by grouping sets ((planned_currency, type), (planned_currency))
    order by planned_currency, type nulls first`.execute(db);
  const out = new Map<string, PlannedTotalDTO>();
  for (const r of rows.rows) {
    if (r.type === null) out.set(r.currency, { currency: r.currency, total: trimAmount(r.amount), priceCount: r.n, unverifiedCount: r.unv, byType: [] });
    else out.get(r.currency)?.byType.push({ type: r.type as PlannedTotalDTO["byType"][number]["type"], amount: trimAmount(r.amount) });
  }
  for (const t of out.values()) t.byType.sort((a, b) => Number(b.amount) - Number(a.amount));
  return [...out.values()];
}

async function comparison(db: Kysely<DB>, tripId: string): Promise<BudgetComparisonDTO | null> {
  const r = await sql<{ currency: string | null; budget: string | null; planned: string; remaining: string; over: boolean }>`
    select t.budget_currency as currency, t.budget_amount::text as budget,
           coalesce(sum(i.planned_amount), 0)::text as planned,
           (t.budget_amount - coalesce(sum(i.planned_amount), 0))::text as remaining,
           coalesce(sum(i.planned_amount), 0) > t.budget_amount as over
    from trips t
    left join plan_items i on i.trip_id = t.id and i.deleted_at is null and i.planned_currency = t.budget_currency
    where t.id = ${tripId}
    group by t.id`.execute(db);
  const row = r.rows[0];
  if (!row || !row.currency || row.budget === null) return null;
  return { currency: row.currency, budget: trimAmount(row.budget), planned: trimAmount(row.planned), remaining: trimAmount(row.remaining.replace(/^-/, "")), over: row.over };
}

export async function getTripDetail(db: Kysely<DB>, actor: Actor, tripId: string, now = new Date()): Promise<TripDetailDTO> {
  const { trip, role } = await requireTripRead(db, actor, tripId);
  const today = dateInZone(trip.time_zone, now.getTime());
  const rows = await db.selectFrom("plan_items").selectAll().where("trip_id", "=", trip.id).where("deleted_at", "is", null).execute();
  const items = rows.map((r) => itemDto(r, trip.time_zone, today)).sort(compareItems);
  return {
    trip: {
      ...tripSummary(trip, role, now),
      version: trip.version,
      budget: trip.budget_amount !== null && trip.budget_currency ? { amount: trimAmount(trip.budget_amount), currency: trip.budget_currency } : null,
      today,
    },
    items,
    plannedTotals: await totals(db, trip.id),
    budgetComparison: await comparison(db, trip.id),
  };
}

export async function createTrip(db: Kysely<DB>, actor: Actor, input: TripInput, now = new Date()): Promise<TripSummaryDTO> {
  requireOwnerAccount(actor);
  const point = matchDestination(input.destination);
  const row = await db
    .insertInto("trips")
    .values({
      owner_user_id: actor.userId,
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
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return tripSummary(row, "owner", now);
}

export type ZoneImpact = {
  itemId: string;
  title: string;
  localDate: string;
  localTime: string;
  result: "ok" | "gap" | "ambiguous";
};

/** Inherited timed items whose interpretation changes under a new trip zone (read-only). */
async function zoneImpact(db: Kysely<DB>, tripId: string, zone: string): Promise<ZoneImpact[]> {
  const rows = await db
    .selectFrom("plan_items")
    .select(["id", "title", "local_date", "local_time", "time_disambiguation"])
    .where("trip_id", "=", tripId)
    .where("deleted_at", "is", null)
    .where("type", "<>", "flight")
    .where("time_zone", "is", null)
    .where("local_time", "is not", null)
    .execute();
  return rows.map((r) => {
    const t = r.local_time!.slice(0, 5);
    const res = resolveLocal(r.local_date!, t, zone, null);
    return { itemId: r.id, title: r.title, localDate: r.local_date!, localTime: t, result: res.ok ? "ok" : res.reason };
  });
}

export async function previewTimeZone(db: Kysely<DB>, actor: Actor, tripId: string, zone: string, expectedVersion: number) {
  const { trip } = await requireTripOwner(db, actor, tripId);
  if (trip.version !== expectedVersion) throw conflict();
  const items = await zoneImpact(db, trip.id, zone);
  const dueCount = await db
    .selectFrom("plan_items")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("trip_id", "=", trip.id)
    .where("deleted_at", "is", null)
    .where("booking_status", "=", "needs_booking")
    .where("booking_due_date", "is not", null)
    .executeTakeFirst();
  return { items, bookingTasksAffected: Number(dueCount?.n ?? 0) };
}

export async function updateTrip(db: Kysely<DB>, actor: Actor, tripId: string, patch: TripPatch, now = new Date()): Promise<TripSummaryDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (trip.version !== patch.expectedVersion) throw conflict();

    // Time-zone change: confirmation plus explicit choices for repeated times; gaps block.
    const zoneChanged = patch.timeZone !== trip.time_zone;
    const choices = patch.timeDisambiguationByItem ?? {};
    if (zoneChanged) {
      if (!patch.confirmTimeZoneImpact) throw new HttpError(409, "time_zone_confirmation_required", "Confirm the time-zone change after reviewing its effect.");
      const impact = await zoneImpact(tx as unknown as Kysely<DB>, trip.id, patch.timeZone);
      const errors: FieldError[] = [];
      for (const i of impact) {
        if (i.result === "gap") errors.push({ path: `items.${i.itemId}.localTime`, code: "nonexistent_local_time", message: `${i.title}: ${i.localTime} doesn't exist on ${i.localDate} in ${patch.timeZone}. Change the time or give the event its own time zone first.` });
        if (i.result === "ambiguous" && !choices[i.itemId]) errors.push({ path: `items.${i.itemId}.timeDisambiguation`, code: "ambiguous_local_time", message: `${i.title}: ${i.localTime} happens twice on ${i.localDate}. Choose the earlier or later one.` });
      }
      if (errors.length) throw invalid(errors, "Some event times need attention before changing the time zone.");
      for (const i of impact) {
        const next = i.result === "ambiguous" ? choices[i.itemId]! : null;
        await tx
          .updateTable("plan_items")
          .set({ time_disambiguation: next, version: sql`version + 1`, updated_at: sql`now()` })
          .where("id", "=", i.itemId)
          .execute();
      }
    }

    // Destination and globe point (ATLAS-4, ATLAS-5): explicit edit wins, then rematch catalog points.
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

    const row = await tx
      .updateTable("trips")
      .set({
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
        version: sql`version + 1`,
        updated_at: sql`now()`,
      })
      .where("id", "=", trip.id)
      .where("version", "=", patch.expectedVersion)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw conflict();
    return tripSummary(row, "owner", now);
  });
}

export async function deleteTrip(db: Kysely<DB>, actor: Actor, tripId: string, expectedVersion: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    if (trip.version !== expectedVersion) throw conflict();
    await tx.selectFrom("import_receipts").select("id").where("trip_id", "=", trip.id).forUpdate().execute();
    await tx.updateTable("import_receipts").set({ trip_id: null, payload_hash: null }).where("trip_id", "=", trip.id).execute();
    await tx.deleteFrom("trips").where("id", "=", trip.id).execute();
  });
}

/** ACCESS-10: delete the account, every owned trip (with DASH-5 effects), sessions and grants. */
export async function deleteAccount(db: Kysely<DB>, actor: Actor): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const owned = await tx.selectFrom("trips").select("id").where("owner_user_id", "=", actor.userId).forUpdate().execute();
    if (owned.length) {
      await tx.updateTable("import_receipts").set({ trip_id: null, payload_hash: null }).where("trip_id", "in", owned.map((t) => t.id)).execute();
    }
    await tx.deleteFrom("User").where("id", "=", actor.userId).execute();
  });
}
