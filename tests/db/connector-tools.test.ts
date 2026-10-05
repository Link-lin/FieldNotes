import { sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { call, connectAs, mcpRequest, replyOf, toolText } from "./connector-helpers";
import { event, flight, grant, makeActor, reset, testDb } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { resetRateLimits } from "@/server/core/rate-limit";
import { appendAiItems } from "@/server/modules/import/import.service";
import { createItem } from "@/server/modules/items/items.service";
import { createTrip } from "@/server/modules/trips/trips.service";

const { POST } = await import("@/app/mcp/route");

type Tokens = Awaited<ReturnType<typeof connectAs>>;
const run = async (who: Tokens, name: string, args: unknown = {}) => toolText(await replyOf(await POST(mcpRequest(who.accessToken, call(name, args)))));
const db = () => testDb();
const rows = (tripId: string) => db().selectFrom("plan_items").selectAll().where("trip_id", "=", tripId).orderBy("created_at").orderBy("id").execute();
const counts = async () => Object.fromEntries((await sql<{ name: string; count: number }>`select name, count from usage_counts`.execute(db())).rows.map((r) => [r.name, Number(r.count)]));
const tripVersion = async (id: string) => Number((await db().selectFrom("trips").select("version").where("id", "=", id).executeTakeFirstOrThrow()).version);

// A trip in Lisbon that Ann (on the allowlist) created, with an editor, a viewer and someone with no access.
let ann: Actor, edith: Actor, vera: Actor, eve: Actor;
let owner: Tokens, editor: Tokens, viewer: Tokens, stranger: Tokens;
let tripId: string;
const lisbon = { title: "Lisbon", destination: "Lisbon, Portugal", startDate: "2026-11-01", endDate: "2026-11-05", timeZone: "Europe/Lisbon", budget: { amount: "1500", currency: "EUR" } };

beforeEach(async () => {
  await reset();
  resetRateLimits();
  ann = await makeActor("owner@example.com", "Ann");
  edith = await makeActor("edith@example.com", "Edith");
  vera = await makeActor("vera@example.com", "Vera");
  eve = await makeActor("eve@example.com", "Eve");
  tripId = (await createTrip(db(), ann, lisbon)).id;
  await grant(tripId, edith, "accepted", "editor");
  await grant(tripId, vera, "accepted", "viewer");
  [owner, editor, viewer, stranger] = [await connectAs(ann), await connectAs(edith), await connectAs(vera), await connectAs(eve)];
});

const dinner = { type: "meal", title: "Dinner at Time Out Market", bookingStatus: "Not required", localDate: "2026-11-02", localTime: "20:00", location: "Time Out Market, Lisbon, Portugal", plannedPrice: { amount: "45.50", currency: "EUR" }, notes: "Try the pastel de nata." };
const hotel = { type: "lodging", title: "Hotel Avenida", bookingStatus: "Needs booking", localDate: "2026-11-01", plannedPrice: { amount: "600", currency: "EUR" } };
const outbound = { type: "flight", title: "New York to Lisbon", bookingStatus: "Needs booking", flightDetails: { departure: { airportCode: "JFK" }, arrival: { airportCode: "LIS" } } };

describe("reading", () => {
  it("lists the trips a person can see with their role, and nobody else's", async () => {
    const other = (await createTrip(db(), ann, { ...lisbon, title: "Porto" })).id;
    await grant(other, vera, "accepted", "viewer");
    expect((await run(owner, "list_trips")).json.trips.map((t: { title: string; role: string }) => `${t.title}:${t.role}`).sort()).toEqual(["Lisbon:owner", "Porto:owner"]);
    expect((await run(editor, "list_trips")).json.trips.map((t: { role: string }) => t.role)).toEqual(["editor"]);
    expect((await run(viewer, "list_trips")).json.trips).toHaveLength(2);
    expect((await run(stranger, "list_trips")).json).toEqual({});
  });

  it("returns a trip with its items in page order, booking state in the import's words and who added each", async () => {
    await createItem(db(), ann, tripId, event({ title: "Walk Alfama", localDate: "2026-11-03", localTime: "10:00", bookingStatus: "not_required", plannedPrice: { amount: "30", currency: "EUR", label: "quote" } }));
    await createItem(db(), ann, tripId, flight({ title: "Booked flight", bookingStatus: "booked", departure: { airportCode: "JFK", localDateTime: "2026-11-01T09:00", timeZone: "America/New_York", timeDisambiguation: null }, arrival: { airportCode: "LIS", localDateTime: "2026-11-01T20:00", timeZone: "Europe/Lisbon", timeDisambiguation: null } }));
    await appendAiItems(db(), ann, tripId, [{ ...hotel, plannedPrice: { amount: "600.00", currency: "EUR" } }]);
    const { json, isError } = await run(owner, "get_trip", { tripId });
    expect(isError).toBe(false);
    expect(json.trip).toMatchObject({ id: tripId, title: "Lisbon", destination: "Lisbon, Portugal", startDate: "2026-11-01", endDate: "2026-11-05", timeZone: "Europe/Lisbon", role: "owner", budget: { amount: "1500", currency: "EUR" } });
    expect(json.trip.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.items.map((i: { title: string }) => i.title)).toEqual(["Booked flight", "Hotel Avenida", "Walk Alfama"]);
    const [flightItem, hotelItem, walk] = json.items;
    expect(flightItem).toMatchObject({ bookingStatus: "Booked", addedBy: "person", flightDetails: { departure: { airportCode: "JFK", localDateTime: "2026-11-01T09:00", timeZone: "America/New_York" } } });
    expect(hotelItem).toMatchObject({ bookingStatus: "Needs booking", addedBy: "ai", plannedPrice: { amount: "600", currency: "EUR", label: "estimate", setBy: "ai" } });
    expect(walk).toMatchObject({ bookingStatus: "Not required", localDate: "2026-11-03", localTime: "10:00", plannedPrice: { amount: "30", label: "quote", setBy: "person" } });
    expect(json.plannedTotals).toEqual([{ currency: "EUR", total: "630", ofWhichAiEstimates: 1 }]);
    expect(json.budgetComparison).toMatchObject({ currency: "EUR", budget: "1500", planned: "630", remaining: "870", over: false });
    // Compact: nothing that is empty, nothing internal.
    expect(JSON.stringify(json)).not.toMatch(/null|"version"|example\.com|owner_user_id/);
  });

  it("lets a viewer read, and tells a stranger the trip does not exist", async () => {
    expect((await run(viewer, "get_trip", { tripId })).isError).toBe(false);
    const nope = await run(stranger, "get_trip", { tripId });
    expect(nope.isError).toBe(true);
    expect(nope.text).toMatch(/doesn't exist, or this account can't see it/);
    expect(nope.text).not.toContain("Lisbon");
    expect((await run(owner, "get_trip", { tripId: "00000000-0000-4000-8000-000000000000" })).isError).toBe(true);
  });

  it("cuts long notes in the trip and returns them whole for one item", async () => {
    const item = await createItem(db(), ann, tripId, event({ notes: "N".repeat(2000) }));
    const trip = (await run(owner, "get_trip", { tripId })).json.items[0];
    expect(trip.notesTruncated).toBe(true);
    expect(trip.notes.length).toBe(401);
    const full = (await run(owner, "get_item", { tripId, itemId: item.id })).json.item;
    expect(full.notes).toHaveLength(2000);
    expect(full.notesTruncated).toBeUndefined();
  });

  it("keeps a very large trip under the result cap and says how many items were left out", async () => {
    const values = Array.from({ length: 250 }, (_, i) => ({ trip_id: tripId, type: "activity" as const, title: `Item ${i}`, notes: "x".repeat(4900), links: "[]", booking_status: "not_required" as const, source: "manual" as const, local_date: "2026-11-02" }));
    await db().insertInto("plan_items").values(values).execute();
    const r = await run(owner, "get_trip", { tripId });
    expect(r.text.length).toBeLessThanOrEqual(100_000);
    expect(r.json.omittedItems).toBeGreaterThan(0);
    expect(r.json.items.length + r.json.omittedItems).toBe(250);
    expect(r.json.note).toMatch(/get_item/);
  });

  it("reads one item, and not one from another trip or one that is deleted", async () => {
    const mine = await createItem(db(), ann, tripId, event());
    const otherTrip = (await createTrip(db(), ann, { ...lisbon, title: "Porto" })).id;
    expect((await run(owner, "get_item", { tripId, itemId: mine.id })).json.item).toMatchObject({ id: mine.id, title: "Fushimi Inari at sunrise" });
    expect((await run(owner, "get_item", { tripId: otherTrip, itemId: mine.id })).isError).toBe(true);
    await run(owner, "delete_item", { tripId, itemId: mine.id });
    expect((await run(owner, "get_item", { tripId, itemId: mine.id })).isError).toBe(true);
    expect((await run(stranger, "get_item", { tripId, itemId: mine.id })).isError).toBe(true);
  });
});

describe("add_items", () => {
  it("saves items as AI drafts with estimate prices, for an editor and for the owner", async () => {
    const before = await tripVersion(tripId);
    const r = await run(editor, "add_items", { tripId, items: [dinner, hotel, outbound] });
    expect(r.isError).toBe(false);
    expect(r.json.added).toHaveLength(3);
    expect(r.json.message).toMatch(/unverified AI drafts/);
    const saved = await rows(tripId);
    expect(saved.map((s) => s.source)).toEqual(["ai", "ai", "ai"]);
    const meal = saved.find((s) => s.title === "Dinner at Time Out Market")!;
    expect(meal).toMatchObject({ type: "meal", booking_status: "not_required", local_date: "2026-11-02", location: "Time Out Market, Lisbon, Portugal", price_source: "ai", price_label: "estimate", map_url: null, latitude: null, booking_due_date: null });
    expect(meal.local_time!.slice(0, 5)).toBe("20:00");
    expect(Number(meal.planned_amount)).toBe(45.5);
    expect(saved.find((s) => s.title === "New York to Lisbon")).toMatchObject({ type: "flight", booking_status: "needs_booking", departure_airport_code: "JFK", arrival_airport_code: "LIS" });
    expect(await tripVersion(tripId)).toBe(before + 1);
    expect((await run(owner, "add_items", { tripId, items: [{ type: "activity", title: "Belém Tower", bookingStatus: "Not required" }] })).isError).toBe(false);
    expect(await counts()).toMatchObject({ connector_items_created: 4 });
    expect(await counts()).not.toHaveProperty("import_items_created");
    expect(await counts()).not.toHaveProperty("manual_item_created");
  });

  it("returns each added item with its id, so the next call can name it", async () => {
    const { json } = await run(owner, "add_items", { tripId, items: [dinner] });
    const id = json.added[0].id;
    expect((await run(owner, "get_item", { tripId, itemId: id })).json.item.title).toBe("Dinner at Time Out Market");
  });

  it("refuses everything, saving nothing, when one item is wrong, and says where", async () => {
    const r = await run(owner, "add_items", {
      tripId,
      items: [dinner, { ...dinner, title: "B", bookingStatus: "Booked" }, { type: "activity", title: "C", bookingStatus: "Not required", localTime: "09:00" }, { ...outbound, flightDetails: undefined }, { ...dinner, title: "E", mapUrl: "https://maps.example/x" }, { ...dinner, title: "F", bookingDueDate: "2026-10-30" }],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Nothing was saved/);
    expect(r.text).toMatch(/items\[1\]\.bookingStatus/);
    expect(r.text).toMatch(/items\[2\]\.localDate/);
    expect(r.text).toMatch(/items\[3\]\.flightDetails/);
    expect(r.text).toMatch(/items\[4\]\.mapUrl/);
    expect(r.text).toMatch(/items\[5\]\.bookingDueDate/);
    expect(await rows(tripId)).toHaveLength(0);
  });

  it("applies the trip's own time zone: a time that does not exist there is refused", async () => {
    const gap = { type: "activity", title: "Early walk", bookingStatus: "Not required", localDate: "2026-03-29", localTime: "01:30" };
    const r = await run(owner, "add_items", { tripId, items: [gap] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/items\[0\]\.localTime.*does not exist/);
    // The same wall-clock time is fine in a zone without that change.
    expect((await run(owner, "add_items", { tripId, items: [{ ...gap, timeZone: "Asia/Tokyo" }] })).isError).toBe(false);
  });

  it("refuses prices without a currency, unsafe links and flights that need no booking", async () => {
    const r = await run(owner, "add_items", {
      tripId,
      items: [{ ...dinner, plannedPrice: { amount: "5" } }, { ...dinner, links: [{ label: "x", url: "javascript:alert(1)" }] }, { ...outbound, bookingStatus: "Not required" }],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/items\[0\]\.plannedPrice/);
    expect(r.text).toMatch(/items\[1\]\.links/);
    expect(r.text).toMatch(/items\[2\]\.bookingStatus/);
    expect(await rows(tripId)).toHaveLength(0);
  });

  it("takes at most 50 items a call, and no more than the trip can hold", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...dinner, title: `Dinner ${i}` }));
    const r = await run(owner, "add_items", { tripId, items: many });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/at most 50/);
    expect((await run(owner, "add_items", { tripId, items: [] })).isError).toBe(true);
    await db().insertInto("plan_items").values(Array.from({ length: 249 }, (_, i) => ({ trip_id: tripId, type: "other" as const, title: `x${i}`, links: "[]", booking_status: "not_required" as const, source: "manual" as const }))).execute();
    const two = await run(owner, "add_items", { tripId, items: [dinner, hotel] });
    expect(two.isError).toBe(true);
    expect(two.text).toMatch(/at most 250/);
    expect(await rows(tripId)).toHaveLength(249);
    expect((await run(owner, "add_items", { tripId, items: [dinner] })).isError).toBe(false);
  });

  it("is refused for a viewer and for a stranger, and writes nothing", async () => {
    const v = await run(viewer, "add_items", { tripId, items: [dinner] });
    expect(v.isError).toBe(true);
    expect(v.text).toMatch(/isn't allowed to do that/);
    const s = await run(stranger, "add_items", { tripId, items: [dinner] });
    expect(s.isError).toBe(true);
    expect(s.text).toMatch(/doesn't exist/);
    expect(await rows(tripId)).toHaveLength(0);
    expect(await tripVersion(tripId)).toBe(1);
  });

  it("is not available to a connection that was not allowed to make changes", async () => {
    const readOnly = await connectAs(ann, { write: false });
    const r = await run(readOnly, "add_items", { tripId, items: [dinner] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/read-only/);
    expect(await rows(tripId)).toHaveLength(0);
  });
});

describe("update_item", () => {
  it("changes only what it names, keeps the item's origin, and counts nothing as a person's edit", async () => {
    const item = await createItem(db(), ann, tripId, event({ title: "Castle", notes: "Bring a hat", localDate: "2026-11-02", localTime: "09:00", location: "Castelo de S. Jorge" }));
    const r = await run(editor, "update_item", { tripId, itemId: item.id, localTime: "11:30" });
    expect(r.isError).toBe(false);
    expect(r.json.item).toMatchObject({ title: "Castle", notes: "Bring a hat", localDate: "2026-11-02", localTime: "11:30", location: "Castelo de S. Jorge", addedBy: "person" });
    const row = (await rows(tripId))[0]!;
    expect(row.source).toBe("manual");
    expect(row.version).toBe(item.version + 1);
    expect(await counts()).not.toHaveProperty("ai_item_edited");
    // null clears, an empty string clears too.
    const cleared = await run(editor, "update_item", { tripId, itemId: item.id, notes: null, durationMinutes: 90 });
    expect(cleared.json.item.notes).toBeUndefined();
    expect(cleared.json.item.durationMinutes).toBe(90);
  });

  it("saves a new or changed price as an AI estimate, keeps one that is unchanged, and clears one on null", async () => {
    const item = await createItem(db(), ann, tripId, event({ plannedPrice: { amount: "30", currency: "EUR", label: "quote" } }));
    const same = await run(owner, "update_item", { tripId, itemId: item.id, plannedPrice: { amount: "30.00", currency: "EUR" } });
    expect(same.json.item.plannedPrice).toMatchObject({ amount: "30", label: "quote", setBy: "person" });
    const changed = await run(owner, "update_item", { tripId, itemId: item.id, plannedPrice: { amount: "35", currency: "EUR" } });
    expect(changed.json.item.plannedPrice).toMatchObject({ amount: "35", label: "estimate", setBy: "ai" });
    const again = await run(owner, "update_item", { tripId, itemId: item.id, plannedPrice: { amount: "35", currency: "EUR" } });
    expect(again.json.item.plannedPrice).toMatchObject({ setBy: "ai", label: "estimate" });
    const gone = await run(owner, "update_item", { tripId, itemId: item.id, plannedPrice: null });
    expect(gone.json.item.plannedPrice).toBeUndefined();
    const bad = await run(owner, "update_item", { tripId, itemId: item.id, plannedPrice: { amount: "10", currency: "XXQ" } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/plannedPrice/);
  });

  it("removes the map pin when the place changes, and leaves it when something else does", async () => {
    const item = await createItem(db(), ann, tripId, event({ location: "Belém Tower", mapUrl: "https://www.google.com/maps/@38.6916,-9.2160,17z" }));
    expect((await run(owner, "get_item", { tripId, itemId: item.id })).json.item.onMap).toBe(true);
    const notes = await run(owner, "update_item", { tripId, itemId: item.id, notes: "Closed Mondays", location: "Belém Tower" });
    expect(notes.json.item.onMap).toBe(true);
    expect(notes.json.message).toBe("Saved.");
    const moved = await run(owner, "update_item", { tripId, itemId: item.id, location: "Jerónimos Monastery, Lisbon" });
    expect(moved.json.item.onMap).toBeUndefined();
    expect(moved.json.message).toMatch(/map pin was removed/);
    expect((await rows(tripId))[0]).toMatchObject({ map_url: null, latitude: null, longitude: null, location: "Jerónimos Monastery, Lisbon" });
  });

  it("can say an item needs booking or not, never that it is booked, and never undoes a person's Booked", async () => {
    const needs = await createItem(db(), ann, tripId, event({ title: "Tour", bookingStatus: "needs_booking", bookingDueDate: "2026-10-20" }));
    const off = await run(owner, "update_item", { tripId, itemId: needs.id, bookingStatus: "Not required" });
    expect(off.json.item.bookingStatus).toBe("Not required");
    expect(off.json.item.bookByDate).toBeUndefined();
    expect((await run(owner, "update_item", { tripId, itemId: needs.id, bookingStatus: "Needs booking" })).json.item.bookingStatus).toBe("Needs booking");
    const booked = await run(owner, "update_item", { tripId, itemId: needs.id, bookingStatus: "Booked" });
    expect(booked.isError).toBe(true);
    expect(booked.text).toMatch(/bookingStatus/);

    const done = await createItem(db(), ann, tripId, event({ title: "Confirmed dinner", bookingStatus: "booked", localDate: "2026-11-03", localTime: "19:00" }));
    const undo = await run(owner, "update_item", { tripId, itemId: done.id, bookingStatus: "Needs booking" });
    expect(undo.isError).toBe(true);
    expect(undo.text).toMatch(/marked Booked/);
    // Other changes to it are fine, and it stays Booked.
    const time = await run(owner, "update_item", { tripId, itemId: done.id, localTime: "19:30" });
    expect(time.json.item).toMatchObject({ bookingStatus: "Booked", localTime: "19:30" });
  });

  it("never sets a book-by date, a quote or a map link, which it has no field for", async () => {
    const item = await createItem(db(), ann, tripId, event({ bookingStatus: "needs_booking" }));
    for (const patch of [{ bookingDueDate: "2026-10-30" }, { mapUrl: "https://maps.example/x" }, { source: "manual" }, { plannedPrice: { amount: "1", currency: "EUR", label: "quote" } }]) {
      const r = await run(owner, "update_item", { tripId, itemId: item.id, ...patch });
      expect(r.isError, JSON.stringify(patch)).toBe(true);
    }
  });

  it("changes the type among ordinary types only, never to or from a flight", async () => {
    const item = await createItem(db(), ann, tripId, event());
    expect((await run(owner, "update_item", { tripId, itemId: item.id, type: "meal" })).json.item.type).toBe("meal");
    expect((await run(owner, "update_item", { tripId, itemId: item.id, type: "flight" })).isError).toBe(true);
    const fl = await createItem(db(), ann, tripId, flight());
    const toMeal = await run(owner, "update_item", { tripId, itemId: fl.id, type: "meal" });
    expect(toMeal.isError).toBe(true);
    expect(toMeal.text).toMatch(/can't become another type/);
  });

  it("edits a flight through flightDetails, and only a flight", async () => {
    const fl = await createItem(db(), ann, tripId, flight({ title: "Outbound", plannedDepartureDate: "2026-11-01" }));
    const set = await run(owner, "update_item", {
      tripId,
      itemId: fl.id,
      flightDetails: { plannedDepartureDate: null, airline: "TAP", flightNumber: "TP202", departure: { airportCode: "JFK", localDateTime: "2026-11-01T21:00", timeZone: "America/New_York" }, arrival: { airportCode: "LIS", localDateTime: "2026-11-02T09:00", timeZone: "Europe/Lisbon" } },
    });
    expect(set.isError).toBe(false);
    expect(set.json.item.flightDetails).toMatchObject({ airline: "TAP", flightNumber: "TP202", departure: { airportCode: "JFK", localDateTime: "2026-11-01T21:00" } });
    expect(set.json.item.bookingStatus).toBe("Needs booking");
    const early = await run(owner, "update_item", { tripId, itemId: fl.id, flightDetails: { arrival: { localDateTime: "2026-11-01T20:00", timeZone: "America/New_York" } } });
    expect(early.isError).toBe(true);
    expect(early.text).toMatch(/Arrival must be after departure/);
    expect((await run(owner, "update_item", { tripId, itemId: fl.id, localDate: "2026-11-01" })).text).toMatch(/flightDetails/);
    const meal = await createItem(db(), ann, tripId, event());
    expect((await run(owner, "update_item", { tripId, itemId: meal.id, flightDetails: { airline: "TAP" } })).text).toMatch(/Only a flight/);
  });

  it("refuses an empty change and invalid values with the field, and changes nothing", async () => {
    const item = await createItem(db(), ann, tripId, event({ localDate: "2026-11-02", localTime: "09:00" }));
    const before = (await rows(tripId))[0]!;
    expect((await run(owner, "update_item", { tripId, itemId: item.id })).text).toMatch(/Nothing to change/);
    for (const patch of [{ localTime: "25:00" }, { localDate: "2026-02-30" }, { localDate: null }, { title: "" }, { durationMinutes: 0 }, { timeZone: "Mars/Olympus" }, { localDate: "2026-03-29", localTime: "01:30" }]) {
      const r = await run(owner, "update_item", { tripId, itemId: item.id, ...patch });
      expect(r.isError, JSON.stringify(patch)).toBe(true);
    }
    const after = (await rows(tripId))[0]!;
    expect(after.version).toBe(before.version);
    expect(after.local_time).toBe(before.local_time);
  });

  it("is refused for a viewer and a stranger, and for an item of another trip", async () => {
    const item = await createItem(db(), ann, tripId, event());
    expect((await run(viewer, "update_item", { tripId, itemId: item.id, title: "x" })).text).toMatch(/isn't allowed/);
    expect((await run(stranger, "update_item", { tripId, itemId: item.id, title: "x" })).text).toMatch(/doesn't exist/);
    const other = (await createTrip(db(), ann, { ...lisbon, title: "Porto" })).id;
    expect((await run(owner, "update_item", { tripId: other, itemId: item.id, title: "x" })).text).toMatch(/doesn't exist/);
    expect((await rows(tripId))[0]!.title).toBe("Fushimi Inari at sunrise");
  });
});

describe("delete_item and restore_item", () => {
  it("deletes at once, lists it no more, and restores the same item within ten minutes", async () => {
    const item = await createItem(db(), ann, tripId, event({ title: "Keep me" }));
    const gone = await run(editor, "delete_item", { tripId, itemId: item.id });
    expect(gone.isError).toBe(false);
    expect(gone.json.deleted).toEqual({ id: item.id, title: "Keep me" });
    expect((await run(owner, "get_trip", { tripId })).json.items).toEqual([]);
    expect((await run(owner, "delete_item", { tripId, itemId: item.id })).isError).toBe(true);
    const back = await run(editor, "restore_item", { tripId, itemId: item.id });
    expect(back.json.restored).toMatchObject({ id: item.id, title: "Keep me" });
    expect((await run(owner, "get_trip", { tripId })).json.items).toHaveLength(1);
    expect(await counts()).not.toHaveProperty("ai_item_deleted");
  });

  it("cannot restore after ten minutes", async () => {
    const item = await createItem(db(), ann, tripId, event());
    await run(owner, "delete_item", { tripId, itemId: item.id });
    await db().updateTable("plan_items").set({ deleted_at: new Date(Date.now() - 11 * 60_000) }).execute();
    const late = await run(owner, "restore_item", { tripId, itemId: item.id });
    expect(late.isError).toBe(true);
    expect(late.text).toMatch(/10 minutes/);
  });

  it("is refused for a viewer and a stranger", async () => {
    const item = await createItem(db(), ann, tripId, event());
    expect((await run(viewer, "delete_item", { tripId, itemId: item.id })).isError).toBe(true);
    expect((await run(stranger, "delete_item", { tripId, itemId: item.id })).isError).toBe(true);
    expect((await rows(tripId))[0]!.deleted_at).toBeNull();
    await run(owner, "delete_item", { tripId, itemId: item.id });
    expect((await run(viewer, "restore_item", { tripId, itemId: item.id })).isError).toBe(true);
    expect((await run(stranger, "restore_item", { tripId, itemId: item.id })).isError).toBe(true);
  });
});

describe("create_trip", () => {
  const plan = {
    trip: { title: "Porto weekend", destination: "Porto, Portugal", startDate: "2027-03-05", endDate: "2027-03-07", timeZone: "Europe/Lisbon", budget: { amount: "800", currency: "EUR" } },
    items: [{ type: "lodging", title: "Hotel Infante", bookingStatus: "Needs booking", localDate: "2027-03-05" }, { type: "activity", title: "Port tasting", bookingStatus: "Needs booking", localDate: "2027-03-06", localTime: "16:00", plannedPrice: { amount: "25", currency: "EUR" } }],
  };

  it("creates the trip and its items as AI drafts, for an account on the owner allowlist", async () => {
    const r = await run(owner, "create_trip", plan);
    expect(r.isError).toBe(false);
    expect(r.json.trip).toMatchObject({ title: "Porto weekend", role: "owner", status: "upcoming" });
    expect(r.json.items).toHaveLength(2);
    expect(r.json.message).toMatch(/unverified AI drafts/);
    const trip = await db().selectFrom("trips").selectAll().where("id", "=", r.json.trip.id).executeTakeFirstOrThrow();
    expect(trip).toMatchObject({ owner_user_id: ann.userId, time_zone: "Europe/Lisbon", budget_currency: "EUR", version: 1 });
    expect(Number(trip.budget_amount)).toBe(800);
    const items = await rows(trip.id);
    expect(items.map((i) => i.source)).toEqual(["ai", "ai"]);
    expect(items.find((i) => i.title === "Port tasting")).toMatchObject({ price_source: "ai", price_label: "estimate" });
    expect(await counts()).toMatchObject({ connector_trip_created: 1, connector_items_created: 2 });
    expect(await counts()).not.toHaveProperty("import_trip_created");
    expect((await run(owner, "list_trips")).json.trips.map((t: { title: string }) => t.title)).toContain("Porto weekend");
  });

  it("creates a trip with no items and no budget", async () => {
    const r = await run(owner, "create_trip", { trip: { ...plan.trip, budget: undefined } });
    expect(r.isError).toBe(false);
    expect(r.json.items).toBeUndefined();
    const trip = await db().selectFrom("trips").selectAll().where("id", "=", r.json.trip.id).executeTakeFirstOrThrow();
    expect(trip.budget_amount).toBeNull();
  });

  it("is refused, and the tool unlisted, for an account that may not create trips", async () => {
    const before = (await db().selectFrom("trips").selectAll().execute()).length;
    for (const who of [editor, viewer, stranger]) {
      const r = await run(who, "create_trip", plan);
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/isn't allowed/);
    }
    expect((await db().selectFrom("trips").selectAll().execute()).length).toBe(before);
  });

  it("creates nothing when the trip or an item is wrong, and says where", async () => {
    const before = (await db().selectFrom("trips").selectAll().execute()).length;
    const trip = await run(owner, "create_trip", { trip: { ...plan.trip, endDate: "2027-03-01", timeZone: "Mars/Base", surprise: 1 }, items: plan.items });
    expect(trip.isError).toBe(true);
    expect(trip.text).toMatch(/trip\.endDate/);
    expect(trip.text).toMatch(/trip\.timeZone/);
    expect(trip.text).toMatch(/trip/);
    const item = await run(owner, "create_trip", { trip: plan.trip, items: [plan.items[0], { ...plan.items[1], bookingStatus: "Booked" }] });
    expect(item.isError).toBe(true);
    expect(item.text).toMatch(/items\[1\]\.bookingStatus/);
    const notAnObject = await run(owner, "create_trip", { trip: "Porto" });
    expect(notAnObject.isError).toBe(true);
    const badBudget = await run(owner, "create_trip", { trip: { ...plan.trip, budget: { amount: "800", currency: "ZZZ" } } });
    expect(badBudget.isError).toBe(true);
    expect((await db().selectFrom("trips").selectAll().execute()).length).toBe(before);
    expect(await counts()).not.toHaveProperty("connector_trip_created");
  });
});

describe("roles apply on the next request", () => {
  it("lets a demoted editor read but not write, and a revoked one see nothing", async () => {
    expect((await run(editor, "add_items", { tripId, items: [dinner] })).isError).toBe(false);
    await db().updateTable("trip_viewers").set({ role: "viewer" }).where("viewer_user_id", "=", edith.userId).execute();
    expect((await run(editor, "add_items", { tripId, items: [dinner] })).isError).toBe(true);
    expect((await run(editor, "get_trip", { tripId })).isError).toBe(false);
    await db().updateTable("trip_viewers").set({ status: "revoked", invitation_token_hash: null, revoked_at: new Date() }).where("viewer_user_id", "=", edith.userId).execute();
    expect((await run(editor, "get_trip", { tripId })).isError).toBe(true);
    expect((await run(editor, "list_trips")).json).toEqual({});
  });

  it("stops a creator who is no longer on the allowlist from reaching their own trip through the connector", async () => {
    const old = await makeActor("former@example.com", "Former");
    const tripOfOld = (await db().insertInto("trips").values({ owner_user_id: old.userId, title: "Old", destination: "Rome", start_date: "2026-11-01", end_date: "2026-11-02", time_zone: "Europe/Rome" }).returning("id").executeTakeFirstOrThrow()).id;
    const tokens = await connectAs(old);
    expect((await run(tokens, "get_trip", { tripId: tripOfOld })).isError).toBe(true);
    expect((await run(tokens, "list_trips")).json).toEqual({});
  });
});

describe("handing the person over to Field Notes (TRIP-11)", () => {
  const link = (id: string) => `http://localhost:3000/trips/${id}`;

  it("gives every trip's address, so the chat can send the person to the page it updates", async () => {
    const listed = await run(owner, "list_trips");
    expect(listed.json.trips).toEqual([expect.objectContaining({ id: tripId, url: link(tripId) })]);
    expect((await run(viewer, "get_trip", { tripId })).json.trip.url).toBe(link(tripId));
    const added = await run(owner, "add_items", { tripId, items: [dinner] });
    expect(added.json.tripUrl).toBe(link(tripId));
    expect(added.json.message).toContain(link(tripId));
    const made = await run(owner, "create_trip", { trip: { title: "Porto", destination: "Porto, Portugal", startDate: "2027-03-05", endDate: "2027-03-07", timeZone: "Europe/Lisbon" } });
    expect(made.json.trip.url).toBe(link(made.json.trip.id));
    expect(made.json.message).toContain(link(made.json.trip.id));
  });
});
