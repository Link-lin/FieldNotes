import { beforeEach, describe, expect, it } from "vitest";
import { commitImport } from "@/server/modules/import/import.service";
import { deleteTrip } from "@/server/modules/trips/trips.service";
import { updateItem } from "@/server/modules/items/items.service";
import type { ImportCommitInput, PlanItemDraftDTO } from "@/shared/import";
import { event, makeActor, reset, testDb } from "./helpers";

const flightEndpoint = { airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null };
const baseItem = {
  location: null,
  notes: null,
  links: [],
  bookingStatus: "needs_booking" as const,
  bookingDueDate: null,
  plannedPrice: null,
  localDate: null,
  localTime: null,
  timeZone: null,
  durationMinutes: null,
  timeDisambiguation: null,
  flightDetails: null,
};

const draft: ImportCommitInput = {
  expectedFormatVersion: 1,
  ownerProvidedBudget: { amount: "1000.00", currency: "USD" },
  trip: {
    title: "Tokyo week",
    destination: "Tokyo, Japan",
    startDate: "2027-04-14",
    endDate: "2027-04-18",
    timeZone: "Asia/Tokyo",
    budget: { amount: "1000.00", currency: "USD" },
  },
  items: [
    {
      ...baseItem,
      type: "flight",
      title: "Outbound flight",
      plannedPrice: { amount: "620.00", currency: "USD" },
      flightDetails: {
        plannedDepartureDate: "2027-04-14",
        airline: null,
        flightNumber: null,
        departure: { ...flightEndpoint, airportCode: "KSFO" },
        arrival: { ...flightEndpoint, airportCode: "HND" },
      },
    },
    {
      ...baseItem,
      type: "activity",
      title: "Explore Tokyo",
      bookingStatus: "not_required",
      localDate: "2027-04-15",
      plannedPrice: { amount: "30.00", currency: "USD" },
    },
  ] as PlanItemDraftDTO[],
};

let owner: Awaited<ReturnType<typeof makeActor>>;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com");
});

describe("AI import transaction", () => {
  it("creates one trip with editable AI items, estimate prices and no map pins", async () => {
    const key = crypto.randomUUID();
    const result = await commitImport(testDb(), owner, draft, key);
    expect(result.reused).toBe(false);
    const items = await testDb().selectFrom("plan_items").selectAll().where("trip_id", "=", result.tripId).execute();
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.source === "ai" && item.booking_status !== "booked")).toBe(true);
    expect(items.every((item) => item.map_url === null && item.latitude === null)).toBe(true);
    expect(items.map((item) => [item.price_label, item.price_source])).toEqual([["estimate", "ai"], ["estimate", "ai"]]);
    expect(items[0]?.departure_airport_code).toBe("KSFO");
    const trip = await testDb().selectFrom("trips").selectAll().where("id", "=", result.tripId).executeTakeFirstOrThrow();
    expect(trip.atlas_source).toBe("catalog");
    expect(trip.budget_amount).toBe("1000.0000");
  });

  it("reuses an identical key and payload, rejects changed content, and leaves one trip", async () => {
    const key = crypto.randomUUID();
    const first = await commitImport(testDb(), owner, draft, key);
    const same = await commitImport(testDb(), owner, draft, key);
    expect(same).toEqual({ tripId: first.tripId, reused: true });
    const count = await testDb().selectFrom("trips").select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
    await expect(commitImport(testDb(), owner, { ...draft, trip: { ...draft.trip, title: "Different" } }, key))
      .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("serializes two concurrent commits with the same key", async () => {
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      commitImport(testDb(), owner, draft, key),
      commitImport(testDb(), owner, draft, key),
    ]);
    expect(a.tripId).toBe(b.tripId);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    const count = await testDb().selectFrom("trips").select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  it("lets the owner explicitly verify an unchanged AI price", async () => {
    const created = await commitImport(testDb(), owner, draft, crypto.randomUUID());
    const row = await testDb().selectFrom("plan_items").selectAll().where("trip_id", "=", created.tripId).where("type", "=", "activity").executeTakeFirstOrThrow();
    const edited = await updateItem(testDb(), owner, created.tripId, row.id, {
      expectedVersion: row.version,
      confirmPrice: true,
      item: event({
        title: row.title,
        location: null,
        localDate: row.local_date,
        localTime: null,
        bookingStatus: "not_required",
        plannedPrice: { amount: "30", currency: "USD", label: "estimate" },
      }),
    });
    expect(edited.plannedPrice?.source).toBe("owner");
  });

  it("returns 410 after the imported trip is deleted, without retaining a content hash", async () => {
    const key = crypto.randomUUID();
    const first = await commitImport(testDb(), owner, draft, key);
    await deleteTrip(testDb(), owner, first.tripId, 1);
    const receipt = await testDb().selectFrom("import_receipts").select(["trip_id", "payload_hash"]).executeTakeFirstOrThrow();
    expect(receipt).toEqual({ trip_id: null, payload_hash: null });
    await expect(commitImport(testDb(), owner, draft, key)).rejects.toMatchObject({ status: 410, code: "import_deleted" });
  });

  it("rejects an invalid commit without partial rows", async () => {
    const broken = { ...draft, items: [...draft.items, { ...draft.items[1]!, title: "" }] } as ImportCommitInput;
    await expect(commitImport(testDb(), owner, broken, crypto.randomUUID())).rejects.toMatchObject({ status: 422 });
    const receipts = await testDb().selectFrom("import_receipts").select("id").execute();
    const trips = await testDb().selectFrom("trips").select("id").execute();
    expect(receipts).toHaveLength(0);
    expect(trips).toHaveLength(0);
  });
});
