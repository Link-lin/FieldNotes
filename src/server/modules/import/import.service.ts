import "server-only";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Actor } from "@/server/auth/actor";
import { requireOwnerAccount } from "@/server/auth/access";
import type { DB } from "@/server/core/db/schema";
import { HttpError, invalid } from "@/server/core/http/errors";
import { insertItem } from "@/server/modules/items/items.repository";
import { scheduleErrors, toValues } from "@/server/modules/items/items.rules";
import { matchDestination } from "@/server/modules/places/catalog";
import { insertTrip } from "@/server/modules/trips/trips.repository";
import type { PlanItemDraftDTO, ImportCommitInput } from "@/shared/import";
import { importCommitSchema } from "@/shared/import";
import { trimAmount } from "@/shared/money";
import { itemInputSchema, toFieldErrors, tripInputSchema, type ItemInput } from "@/shared/schemas";

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

function asItemInput(item: PlanItemDraftDTO): ItemInput {
  const base = {
    title: item.title,
    location: item.location,
    notes: item.notes,
    links: item.links,
    mapUrl: null,
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

  const items: ItemInput[] = input.items.map((draft, index) => {
    const parsed = itemInputSchema.safeParse(asItemInput(draft));
    if (!parsed.success) throw invalid(toFieldErrors(parsed.error).map((e) => ({ ...e, path: itemPath(index, e.path) })));
    if (parsed.data.bookingStatus === "booked") {
      throw invalid([{ path: `items[${index}].bookingStatus`, code: "invalid", message: "AI drafts cannot mark an item booked." }]);
    }
    const schedule = scheduleErrors(parsed.data, tripResult.data.timeZone);
    if (schedule.length) throw invalid(schedule.map((e) => ({ ...e, path: itemPath(index, e.path) })));
    return parsed.data;
  });

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
      for (const [index, item] of items.entries()) {
        const values = toValues(item, null);
        if ("path" in values) throw invalid([{ ...values, path: itemPath(index, values.path) }]);
        // Generic manual creation sets price_source=owner; the import must retain provenance.
        if (item.plannedPrice) values.price_source = "ai";
        await insertItem(tx, trip.id, "ai", values);
      }
      await tx.updateTable("import_receipts")
        .set({ trip_id: trip.id, payload_hash: hash })
        .where("owner_user_id", "=", actor.userId)
        .where("idempotency_key", "=", idempotencyKey)
        .execute();
      return trip.id;
    });
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
