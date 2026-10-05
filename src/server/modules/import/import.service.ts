import "server-only";
import { autoPin, wantsAutoPin } from "@/server/modules/places/auto-pin.service";
import type { Later } from "@/server/core/later";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Actor } from "@/server/auth/actor";
import { requireOwnerAccount, requireTripEditor } from "@/server/auth/access";
import type { Tx } from "@/server/core/db/client";
import type { DB, PlanItemRow } from "@/server/core/db/schema";
import { HttpError, invalid } from "@/server/core/http/errors";
import { itemDto } from "@/server/modules/items/items.mapper";
import { insertItem, liveCount, purgeExpired } from "@/server/modules/items/items.repository";
import { ITEM_CAP } from "@/server/modules/items/items.service";
import { checkAiItems } from "./import.rules";
import { tripSummary } from "@/server/modules/trips/trips.mapper";
import { scheduleErrors, toValues } from "@/server/modules/items/items.rules";
import { matchDestination } from "@/server/modules/places/catalog";
import { bumpTripVersion, insertTrip } from "@/server/modules/trips/trips.repository";
import { countUsage } from "@/server/modules/usage/usage.service";
import type { PlanItemDTO, TripSummaryDTO } from "@/shared/dto";
import type { PlanItemDraftDTO, ImportCommitInput } from "@/shared/import";
import { importCommitSchema } from "@/shared/import";
import { trimAmount } from "@/shared/money";
import { itemInputSchema, toFieldErrors, tripInputSchema, type ItemInput } from "@/shared/schemas";
import { dateInZone } from "@/shared/time";

const KEY_CONSTRAINT = "import_receipts_owner_user_id_idempotency_key_key";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, v]) => [key, stable(v)]));
  }
  return value;
}

function isReceiptKeyConflict(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && err.code === "23505" &&
    "constraint" in err && err.constraint === KEY_CONSTRAINT;
}

function sameMoney(a: { amount: string; currency: string } | null, b: { amount: string; currency: string } | null): boolean {
  if (!a || !b) return a === b;
  return a.currency === b.currency && trimAmount(a.amount) === trimAmount(b.amount);
}

function asItemInput(item: PlanItemDraftDTO, confirmedMapUrl: string | null): ItemInput {
  const base = {
    title: item.title,
    location: item.location,
    notes: item.notes,
    links: item.links,
    mapUrl: confirmedMapUrl,
    bookingStatus: item.bookingStatus,
    bookingDueDate: item.bookingDueDate,
    plannedPrice: item.plannedPrice ? { ...item.plannedPrice, label: "estimate" as const } : null,
  };
  if (item.type === "flight") {
    const flight = item.flightDetails!;
    return {
      ...base,
      type: "flight",
      plannedDepartureDate: flight.plannedDepartureDate,
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      departure: flight.departure,
      arrival: flight.arrival,
    };
  }
  return {
    ...base,
    type: item.type,
    localDate: item.localDate,
    localTime: item.localTime,
    timeZone: item.timeZone,
    durationMinutes: item.durationMinutes,
    timeDisambiguation: item.timeDisambiguation,
  };
}

function itemPath(index: number, path: string): string {
  const nested = path.replace(/^(departure|arrival|plannedDepartureDate|airline|flightNumber)(?=\.|$)/, "flightDetails.$1");
  return `items[${index}]${nested ? `.${nested}` : ""}`;
}

/**
 * Normalized drafts as the schedule and field rules see them: the shared item schema, no `Booked`, and the checks that
 * need the trip's time zone. Errors carry the path of the item they belong to. An import and an AI chat share it.
 */
function validatedItems(drafts: PlanItemDraftDTO[], tripZone: string, confirmedMapUrls?: Array<string | null>): ItemInput[] {
  return drafts.map((draft, index) => {
    const parsed = itemInputSchema.safeParse(asItemInput(draft, confirmedMapUrls?.[index] ?? null));
    if (!parsed.success) throw invalid(toFieldErrors(parsed.error).map((e) => ({ ...e, path: itemPath(index, e.path) })));
    if (parsed.data.bookingStatus === "booked") {
      throw invalid([{ path: `items[${index}].bookingStatus`, code: "invalid", message: "AI drafts cannot mark an item booked." }]);
    }
    const schedule = scheduleErrors(parsed.data, tripZone);
    if (schedule.length) throw invalid(schedule.map((e) => ({ ...e, path: itemPath(index, e.path) })));
    return parsed.data;
  });
}

/** Inserts validated items as AI drafts (IMPORT-7): `source = 'ai'`, and a price is an AI estimate (BUDGET-4). */
async function insertAiItems(tx: Tx, tripId: string, items: ItemInput[]): Promise<PlanItemRow[]> {
  const rows: PlanItemRow[] = [];
  for (const [index, item] of items.entries()) {
    const values = toValues(item, null);
    if ("path" in values) throw invalid([{ ...values, path: itemPath(index, values.path) }]);
    // Generic manual creation sets price_source=owner; the import must retain provenance.
    if (item.plannedPrice) values.price_source = "ai";
    rows.push(await insertItem(tx, tripId, "ai", values));
  }
  return rows;
}

/**
 * IMPORT-8: Revalidate a normalized preview and create the trip/items/receipt atomically.
 * The raw pasted response is never passed to this service or persisted.
 */
export async function commitImport(
  db: Kysely<DB>,
  actor: Actor,
  input: ImportCommitInput,
  idempotencyKey: string,
): Promise<{ tripId: string; reused: boolean }> {
  requireOwnerAccount(actor);
  const commitResult = importCommitSchema.safeParse(input);
  if (!commitResult.success) throw invalid(toFieldErrors(commitResult.error));
  const tripResult = tripInputSchema.safeParse(input.trip);
  if (!tripResult.success) throw invalid(toFieldErrors(tripResult.error).map((e) => ({ ...e, path: `trip.${e.path}` })));
  if (!sameMoney(tripResult.data.budget, input.ownerProvidedBudget)) {
    throw invalid([{ path: "trip.budget", code: "budget_mismatch", message: "Confirm the budget in the preview before creating this trip." }]);
  }

  const items = validatedItems(input.items, tripResult.data.timeZone, input.confirmedMapUrls);

  // Canonical serialization is never stored; the receipt stores only its hash.
  const normalizeMoney = (money: { amount: string; currency: string } | null) =>
    money ? { amount: trimAmount(money.amount), currency: money.currency } : null;
  const canonical = stable({
    formatVersion: 1,
    trip: { ...tripResult.data, budget: normalizeMoney(tripResult.data.budget) },
    items: items.map((item) => ({ ...item, plannedPrice: item.plannedPrice ? { ...item.plannedPrice, amount: trimAmount(item.plannedPrice.amount) } : null })),
    ownerProvidedBudget: normalizeMoney(input.ownerProvidedBudget),
  });
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest();
  try {
    const tripId = await db.transaction().execute(async (tx) => {
      await tx.insertInto("import_receipts").values({ owner_user_id: actor.userId, idempotency_key: idempotencyKey, trip_id: null, payload_hash: null }).execute();
      const point = matchDestination(tripResult.data.destination);
      const trip = await insertTrip(tx, actor.userId, {
        title: tripResult.data.title,
        destination: tripResult.data.destination,
        start_date: tripResult.data.startDate,
        end_date: tripResult.data.endDate,
        time_zone: tripResult.data.timeZone,
        budget_amount: tripResult.data.budget?.amount ?? null,
        budget_currency: tripResult.data.budget?.currency ?? null,
        atlas_latitude: point ? String(point.latitude) : null,
        atlas_longitude: point ? String(point.longitude) : null,
        atlas_source: point ? "catalog" : null,
      });
      await insertAiItems(tx, trip.id, items);
      await tx.updateTable("import_receipts")
        .set({ trip_id: trip.id, payload_hash: hash })
        .where("owner_user_id", "=", actor.userId)
        .where("idempotency_key", "=", idempotencyKey)
        .execute();
      return trip.id;
    });
    await countUsage(db, [
      { name: "import_trip_created" },
      { name: "import_items_created", count: items.length },
      { name: "import_items_skipped", count: input.previewSkipped ?? 0 },
    ]);
    return { tripId, reused: false };
  } catch (err) {
    if (!isReceiptKeyConflict(err)) throw err;
    // Lock only the receipt. Trip deletion locks the trip before its receipts; locking
    // a trip here would invert that order and risk a deadlock.
    return db.transaction().execute(async (tx) => {
      const receipt = await tx.selectFrom("import_receipts").select(["trip_id", "payload_hash"])
        .where("owner_user_id", "=", actor.userId).where("idempotency_key", "=", idempotencyKey)
        .forUpdate().executeTakeFirst();
      if (!receipt) throw new HttpError(409, "import_retry", "The import is still finishing. Try again.");
      if (!receipt.trip_id || !receipt.payload_hash) {
        throw new HttpError(410, "import_deleted", "That imported trip was deleted. Start a new import to create it again.");
      }
      if (!receipt.payload_hash.equals(hash)) {
        throw new HttpError(409, "idempotency_conflict", "This retry differs from the original import. Start a new import to create a different trip.");
      }
      return { tripId: receipt.trip_id, reused: true };
    });
  }
}

/**
 * CONNECT-3, CONNECT-4: a connected AI chat adds items to a trip. They are checked as an import checks them, against
 * the trip's own time zone, and saved as AI drafts. Any error refuses the whole call; nothing is partly saved.
 */
export async function appendAiItems(db: Kysely<DB>, actor: Actor, tripId: string, raw: unknown[], now = new Date(), later?: Later): Promise<PlanItemDTO[]> {
  const { rows, zone } = await db.transaction().execute(async (tx) => {
    const { trip } = await requireTripEditor(tx, actor, tripId, true);
    await purgeExpired(tx, trip.id);
    const checked = checkAiItems(raw, trip.time_zone);
    if ("errors" in checked) throw invalid(checked.errors);
    const items = validatedItems(checked.drafts, trip.time_zone);
    const have = await liveCount(tx, trip.id);
    if (have + items.length > ITEM_CAP) {
      throw new HttpError(409, "item_cap", `A trip can have at most ${ITEM_CAP} events and this one has ${have}, so ${items.length} more won't fit.`);
    }
    const inserted = await insertAiItems(tx, trip.id, items);
    await bumpTripVersion(tx, trip.id);
    return { rows: inserted, zone: trip.time_zone };
  });
  await countUsage(db, [{ name: "connector_items_created", count: rows.length }]);
  const today = dateInZone(zone, now.getTime());
  const added = rows.map((row) => itemDto(row, zone, today));
  // MAP-2: places with a clear match get their pins once the chat has its answer.
  const toPin = added.filter(wantsAutoPin).map((i) => i.id);
  if (later && toPin.length) later(async () => void (await autoPin(db, tripId, toPin)));
  return added;
}

/**
 * CONNECT-3: a connected AI chat creates a trip, with its items, for an allowlisted owner (ACCESS-5). The trip block
 * is the one JSON v1 has (a budget is the person's own, relayed by the chat); items are checked and tagged as an
 * import's are. Atomic: a trip with an invalid item is not created.
 */
export async function createTripByAi(db: Kysely<DB>, actor: Actor, input: { trip: unknown; items: unknown[] }, now = new Date(), later?: Later): Promise<{ trip: TripSummaryDTO; items: PlanItemDTO[] }> {
  requireOwnerAccount(actor);
  const block = input.trip && typeof input.trip === "object" && !Array.isArray(input.trip) ? (input.trip as Record<string, unknown>) : null;
  if (!block) throw invalid([{ path: "trip", code: "invalid", message: "Send the trip as an object with title, destination, startDate, endDate and timeZone." }]);
  const tripResult = tripInputSchema.safeParse({ ...block, budget: block.budget ?? null });
  if (!tripResult.success) throw invalid(toFieldErrors(tripResult.error).map((e) => ({ ...e, path: e.path ? `trip.${e.path}` : "trip" })));
  const trip = tripResult.data;
  if (input.items.length > ITEM_CAP) throw invalid([{ path: "items", code: "too_many_items", message: `A trip can have at most ${ITEM_CAP} items.` }]);
  const checked = checkAiItems(input.items, trip.timeZone);
  if ("errors" in checked) throw invalid(checked.errors);
  const items = validatedItems(checked.drafts, trip.timeZone);
  const point = matchDestination(trip.destination);
  const { row, rows } = await db.transaction().execute(async (tx) => {
    const created = await insertTrip(tx, actor.userId, {
      title: trip.title,
      destination: trip.destination,
      start_date: trip.startDate,
      end_date: trip.endDate,
      time_zone: trip.timeZone,
      budget_amount: trip.budget?.amount ?? null,
      budget_currency: trip.budget?.currency ?? null,
      atlas_latitude: point ? String(point.latitude) : null,
      atlas_longitude: point ? String(point.longitude) : null,
      atlas_source: point ? "catalog" : null,
    });
    return { row: created, rows: await insertAiItems(tx, created.id, items) };
  });
  await countUsage(db, [{ name: "connector_trip_created" }, { name: "connector_items_created", count: rows.length }]);
  const today = dateInZone(row.time_zone, now.getTime());
  const created = rows.map((r) => itemDto(r, row.time_zone, today));
  const toPin = created.filter(wantsAutoPin).map((i) => i.id);
  if (later && toPin.length) later(async () => void (await autoPin(db, row.id, toPin)));
  return { trip: tripSummary(row, { role: "owner", primaryOwner: true }, now), items: created };
}
