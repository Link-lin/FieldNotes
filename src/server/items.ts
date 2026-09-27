import "server-only";
import { sql, type Kysely, type Transaction } from "kysely";
import type { DB, PlanItemRow, PlanItemsTable } from "@/server/core/db/schema";
import type { Insertable } from "kysely";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner } from "@/server/auth/access";
import { itemDto } from "@/server/mapping";
import { conflict, HttpError, invalid, notFound } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import type { ItemInput } from "@/shared/schemas";
import { cleanMapUrl, coordinatesFromMapUrl } from "@/shared/map-links";
import { trimAmount } from "@/shared/money";
import { dateInZone, resolveLocal } from "@/shared/time";
import type { FieldError, PlanItemDTO } from "@/shared/dto";

export const ITEM_CAP = 250;
export const RESTORE_WINDOW_MS = 10 * 60 * 1000;

type Tx = Transaction<DB>;
type Values = Omit<Insertable<PlanItemsTable>, "trip_id" | "source">;

/** Domain checks that need time-zone data: gaps, repeated times, arrival after departure. */
function scheduleErrors(input: ItemInput, tripZone: string): FieldError[] {
  const errors: FieldError[] = [];
  const check = (date: string, time: string, zone: string, choice: "earlier" | "later" | null, path: string) => {
    const r = resolveLocal(date, time, zone, choice);
    if (!r.ok && r.reason === "gap") errors.push({ path, code: "nonexistent_local_time", message: `${time} doesn't exist on ${date} in ${zone} (clocks change). Pick another time.` });
    if (!r.ok && r.reason === "ambiguous") errors.push({ path: path.replace(/localTime$|localDateTime$/, (m) => (m === "localTime" ? "timeDisambiguation" : "timeDisambiguation")), code: "ambiguous_local_time", message: `${time} happens twice on ${date} in ${zone}. Choose the earlier or later one.` });
    return r.ok ? r.epochMs : null;
  };
  if (input.type === "flight") {
    const d = input.departure;
    const a = input.arrival;
    const dep = d.localDateTime && d.timeZone ? check(d.localDateTime.slice(0, 10), d.localDateTime.slice(11), d.timeZone, d.timeDisambiguation, "departure.localDateTime") : null;
    const arr = a.localDateTime && a.timeZone ? check(a.localDateTime.slice(0, 10), a.localDateTime.slice(11), a.timeZone, a.timeDisambiguation, "arrival.localDateTime") : null;
    if (dep !== null && arr !== null && arr <= dep) errors.push({ path: "arrival.localDateTime", code: "arrival_before_departure", message: "Arrival must be after departure." });
  } else if (input.localDate && input.localTime) {
    check(input.localDate, input.localTime, input.timeZone ?? tripZone, input.timeDisambiguation, "localTime");
  }
  return errors;
}

function mapFields(input: ItemInput, current: PlanItemRow | null): { map_url: string | null; latitude: string | null; longitude: string | null } | FieldError {
  const raw = input.mapUrl;
  // MAP-2: only a changed link is re-read; re-sending the stored link never re-pins.
  if (current && (raw ?? null) === current.map_url) {
    return { map_url: current.map_url, latitude: current.latitude, longitude: current.longitude };
  }
  if (!raw) return { map_url: null, latitude: null, longitude: null };
  const clean = cleanMapUrl(raw);
  if (!clean) return { path: "mapUrl", code: "invalid_url", message: "Use a full https link (at most 2048 characters) without a user name, for example one copied from Google Maps." };
  if (current && clean === current.map_url) return { map_url: current.map_url, latitude: current.latitude, longitude: current.longitude };
  const c = coordinatesFromMapUrl(clean);
  return { map_url: clean, latitude: c ? c[0].toFixed(5) : null, longitude: c ? c[1].toFixed(5) : null };
}

function priceFields(input: ItemInput, current: PlanItemRow | null) {
  const p = input.plannedPrice;
  if (!p) return { planned_amount: null, planned_currency: null, price_label: null, price_source: null };
  // BUDGET-4: an AI price stays "unverified" until the owner saves a different amount, currency or label.
  const unchangedAi =
    current?.price_source === "ai" &&
    current.planned_amount !== null &&
    trimAmount(current.planned_amount) === trimAmount(p.amount) &&
    current.planned_currency === p.currency &&
    current.price_label === p.label;
  return { planned_amount: p.amount, planned_currency: p.currency, price_label: p.label, price_source: unchangedAi ? ("ai" as const) : ("owner" as const) };
}

function toValues(input: ItemInput, current: PlanItemRow | null): Values | FieldError {
  const map = mapFields(input, current);
  if ("path" in map) return map;
  const status = input.bookingStatus;
  const base = {
    type: input.type,
    title: input.title,
    location: input.location,
    notes: input.notes,
    links: JSON.stringify(input.links),
    ...map,
    booking_status: status,
    booking_due_date: status === "needs_booking" ? input.bookingDueDate : null,
    ...priceFields(input, current),
  };
  if (input.type === "flight") {
    return {
      ...base,
      local_date: null, local_time: null, time_zone: null, time_disambiguation: null, duration_minutes: null,
      planned_departure_date: input.departure.localDateTime ? null : input.plannedDepartureDate,
      airline: input.airline,
      flight_number: input.flightNumber,
      departure_airport_code: input.departure.airportCode,
      departure_local_datetime: input.departure.localDateTime,
      departure_time_zone: input.departure.timeZone,
      departure_disambiguation: input.departure.localDateTime ? input.departure.timeDisambiguation : null,
      arrival_airport_code: input.arrival.airportCode,
      arrival_local_datetime: input.arrival.localDateTime,
      arrival_time_zone: input.arrival.timeZone,
      arrival_disambiguation: input.arrival.localDateTime ? input.arrival.timeDisambiguation : null,
    };
  }
  return {
    ...base,
    local_date: input.localDate,
    local_time: input.localDate ? input.localTime : null,
    time_zone: input.timeZone,
    time_disambiguation: input.localTime ? input.timeDisambiguation : null,
    duration_minutes: input.durationMinutes,
    planned_departure_date: null, airline: null, flight_number: null,
    departure_airport_code: null, departure_local_datetime: null, departure_time_zone: null, departure_disambiguation: null,
    arrival_airport_code: null, arrival_local_datetime: null, arrival_time_zone: null, arrival_disambiguation: null,
  };
}

async function purgeExpired(tx: Tx, tripId: string) {
  await tx.deleteFrom("plan_items").where("trip_id", "=", tripId).where("deleted_at", "<", sql<Date>`now() - interval '10 minutes'`).execute();
}

async function liveCount(tx: Tx, tripId: string): Promise<number> {
  const r = await tx.selectFrom("plan_items").select((eb) => eb.fn.countAll<number>().as("n")).where("trip_id", "=", tripId).where("deleted_at", "is", null).executeTakeFirst();
  return Number(r?.n ?? 0);
}

async function bumpTrip(tx: Tx, tripId: string) {
  await tx.updateTable("trips").set({ version: sql`version + 1`, updated_at: sql`now()` }).where("id", "=", tripId).execute();
}

function dto(row: PlanItemRow, zone: string, now: Date): PlanItemDTO {
  return itemDto(row, zone, dateInZone(zone, now.getTime()));
}

export async function createItem(db: Kysely<DB>, actor: Actor, tripId: string, input: ItemInput, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await purgeExpired(tx, trip.id);
    if ((await liveCount(tx, trip.id)) >= ITEM_CAP) throw new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events.`);
    const errs = scheduleErrors(input, trip.time_zone);
    if (errs.length) throw invalid(errs);
    const values = toValues(input, null);
    if ("path" in values) throw invalid([values]);
    const row = await tx.insertInto("plan_items").values({ ...values, trip_id: trip.id, source: "manual" }).returningAll().executeTakeFirstOrThrow();
    await bumpTrip(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

async function loadItem(tx: Tx, tripId: string, itemId: string, includeDeleted = false): Promise<PlanItemRow> {
  if (!isUuid(itemId)) throw notFound();
  let q = tx.selectFrom("plan_items").selectAll().where("id", "=", itemId).where("trip_id", "=", tripId).forUpdate();
  if (!includeDeleted) q = q.where("deleted_at", "is", null);
  const row = await q.executeTakeFirst();
  if (!row) throw notFound();
  return row;
}

export async function updateItem(
  db: Kysely<DB>,
  actor: Actor,
  tripId: string,
  itemId: string,
  body: { item: ItemInput; expectedVersion: number; confirmTypeChange?: boolean },
  now = new Date(),
): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await purgeExpired(tx, trip.id);
    const current = await loadItem(tx, trip.id, itemId);
    if (current.version !== body.expectedVersion) throw conflict();
    const input = body.item;
    const crossesFlight = (current.type === "flight") !== (input.type === "flight");
    if (crossesFlight && !body.confirmTypeChange) {
      throw new HttpError(409, "type_change_confirmation_required", "Changing to or from a flight clears the schedule fields. Confirm to continue.");
    }
    const errs = scheduleErrors(input, trip.time_zone);
    if (errs.length) throw invalid(errs);
    const values = toValues(input, current);
    if ("path" in values) throw invalid([values]);
    const row = await tx
      .updateTable("plan_items")
      .set({ ...values, version: sql`version + 1`, updated_at: sql`now()` })
      .where("id", "=", current.id)
      .where("version", "=", body.expectedVersion)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw conflict();
    await bumpTrip(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** TRIP-8: immediate soft delete; restorable for 10 minutes. */
export async function deleteItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    await purgeExpired(tx, trip.id);
    const current = await loadItem(tx, trip.id, itemId);
    if (current.version !== expectedVersion) throw conflict();
    await tx.updateTable("plan_items").set({ deleted_at: sql`now()`, version: sql`version + 1` }).where("id", "=", current.id).execute();
    await bumpTrip(tx, trip.id);
  });
}

export async function restoreItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    const current = await loadItem(tx, trip.id, itemId, true);
    if (!current.deleted_at) return dto(current, trip.time_zone, now);
    if (now.getTime() - new Date(current.deleted_at).getTime() > RESTORE_WINDOW_MS) {
      throw new HttpError(410, "restore_expired", "This event was deleted more than 10 minutes ago and can't be restored.");
    }
    if ((await liveCount(tx, trip.id)) >= ITEM_CAP) throw new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events.`);
    // The trip time zone may have changed since the delete; the restored time must still exist.
    if (current.type !== "flight" && current.local_date && current.local_time && !current.time_zone) {
      const r = resolveLocal(current.local_date, current.local_time.slice(0, 5), trip.time_zone, current.time_disambiguation);
      if (!r.ok) {
        throw new HttpError(409, "restore_time_invalid", `This event's time ${current.local_time.slice(0, 5)} ${r.reason === "gap" ? "doesn't exist" : "happens twice"} on ${current.local_date} in ${trip.time_zone}, so it can't be restored. Add it again with a new time.`);
      }
    }
    await purgeExpired(tx, trip.id);
    const row = await tx
      .updateTable("plan_items")
      .set({ deleted_at: null, version: sql`version + 1` })
      .where("id", "=", current.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await bumpTrip(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}

/** PLAN-3: duplicate; a booked item becomes "needs booking" with no due date. */
export async function duplicateItem(db: Kysely<DB>, actor: Actor, tripId: string, itemId: string, expectedVersion: number, now = new Date()): Promise<PlanItemDTO> {
  return db.transaction().execute(async (tx) => {
    const { trip } = await requireTripOwner(tx, actor, tripId, true);
    const src = await loadItem(tx, trip.id, itemId);
    if (src.version !== expectedVersion) throw conflict();
    await purgeExpired(tx, trip.id);
    if ((await liveCount(tx, trip.id)) >= ITEM_CAP) throw new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events.`);
    const { id: _id, version: _v, created_at: _c, updated_at: _u, deleted_at: _d, links, ...rest } = src;
    void _id; void _v; void _c; void _u; void _d;
    const row = await tx
      .insertInto("plan_items")
      .values({
        ...rest,
        links: JSON.stringify(links),
        booking_status: src.booking_status === "booked" ? "needs_booking" : src.booking_status,
        booking_due_date: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await bumpTrip(tx, trip.id);
    return dto(row, trip.time_zone, now);
  });
}
