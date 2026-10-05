import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "kysely";
import { event, flight, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip, getTripDetail, updateTripFields } from "@/server/modules/trips/trips.service";
import { createItem, updateItemByAi, updateItemFields } from "@/server/modules/items/items.service";
import { itemInputOf, tripFieldsOf } from "@/shared/fields";
import type { Actor } from "@/server/auth/actor";

// The routes run end to end with only the session lookup replaced.
const session = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/auth/session", async () => {
  const { HttpError } = await import("@/server/core/http/errors");
  return {
    currentActor: async () => session.actor,
    requireActor: async () => {
      if (!session.actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
      return session.actor;
    },
  };
});

const itemFields = await import("@/app/api/trips/[tripId]/items/[itemId]/fields/route");
const tripFields = await import("@/app/api/trips/[tripId]/fields/route");

const ORIGIN = "http://localhost:3000";
const patch = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/x`, { method: "PATCH", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const itemCtx = (tripId: string, itemId: string) => ({ params: Promise.resolve({ tripId, itemId }) });
const tripCtx = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const counts = async () => Object.fromEntries((await sql<{ name: string; count: number }>`select name, count from usage_counts`.execute(testDb())).rows.map((r) => [r.name, Number(r.count)]));

let owner: Actor, editor: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  editor = await makeActor("editor@example.com", "Edith");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  session.actor = null;
});

describe("event field saves (TRIP-10)", () => {
  it("saves one field over a newer version that changed another, and bumps the trip version", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    // A connected chat moves the event after the view opened.
    const moved = (await updateItemByAi(testDb(), owner, t.id, i.id, { localTime: "09:30" }, NOW)).item;
    const before = (await getTripDetail(testDb(), owner, t.id, NOW)).trip.version;
    const saved = await updateItemFields(testDb(), owner, t.id, i.id, { changes: { title: "Inari" }, base: { title: i.title } }, NOW);
    expect(saved).toMatchObject({ title: "Inari", localTime: "09:30", version: moved.version + 1, location: i.location });
    expect((await getTripDetail(testDb(), owner, t.id, NOW)).trip.version).toBe(before + 1);
  });

  it("refuses a field changed elsewhere since the edit began, naming it", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    await updateItemByAi(testDb(), owner, t.id, i.id, { title: "Theirs" }, NOW);
    await expect(updateItemFields(testDb(), owner, t.id, i.id, { changes: { title: "Mine" }, base: { title: i.title } }, NOW)).rejects.toMatchObject({
      status: 409,
      code: "field_conflict",
      fields: [{ path: "title" }],
    });
  });

  it("applies the same rules as a full edit", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    // A book-by date only goes with Needs booking; the section sends both together.
    await expect(updateItemFields(testDb(), owner, t.id, i.id, { changes: { bookingDueDate: "2026-11-01" }, base: { bookingDueDate: null } }, NOW)).rejects.toMatchObject({ status: 422 });
    const booking = await updateItemFields(testDb(), owner, t.id, i.id, { changes: { bookingStatus: "needs_booking", bookingDueDate: "2026-11-01" }, base: { bookingStatus: "not_required", bookingDueDate: null } }, NOW);
    expect(booking).toMatchObject({ bookingStatus: "needs_booking", bookingDueDate: "2026-11-01" });
    // A time that doesn't exist is refused by the schedule check.
    const t2 = await createTrip(testDb(), owner, { ...tripInput, timeZone: "America/New_York" }, NOW);
    const j = await createItem(testDb(), owner, t2.id, event({ localDate: "2026-11-01", localTime: null }));
    await expect(updateItemFields(testDb(), owner, t2.id, j.id, { changes: { localTime: "01:30" }, base: { localTime: null } }, NOW)).rejects.toMatchObject({ status: 422, fields: [{ code: "ambiguous_local_time" }] });
  });

  it("asks before an event becomes a flight, then clears its schedule", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    const change = { changes: { type: "flight", bookingStatus: "needs_booking" }, base: { type: "activity", bookingStatus: "not_required" } };
    await expect(updateItemFields(testDb(), owner, t.id, i.id, change, NOW)).rejects.toMatchObject({ status: 409, code: "type_change_confirmation_required" });
    const saved = await updateItemFields(testDb(), owner, t.id, i.id, { ...change, confirmTypeChange: true }, NOW);
    expect(saved).toMatchObject({ type: "flight", localDate: null, localTime: null, flightDetails: { departure: { airportCode: null } } });
  });

  it("marks a flight booked only with both airports, times and zones", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const f = await createItem(testDb(), owner, t.id, flight({ bookingStatus: "needs_booking" }));
    await expect(updateItemFields(testDb(), owner, t.id, f.id, { changes: { bookingStatus: "booked" }, base: { bookingStatus: "needs_booking" } }, NOW)).rejects.toMatchObject({ status: 422 });
    const dep = { airportCode: "SFO", localDateTime: "2026-11-15T11:00", timeZone: "America/Los_Angeles", timeDisambiguation: null };
    const arr = { airportCode: "HND", localDateTime: "2026-11-16T15:30", timeZone: "Asia/Tokyo", timeDisambiguation: null };
    const input = itemInputOf(f);
    const scheduled = await updateItemFields(testDb(), owner, t.id, f.id, { changes: { departure: dep, arrival: arr }, base: { departure: input.type === "flight" ? input.departure : null, arrival: input.type === "flight" ? input.arrival : null } }, NOW);
    const booked = await updateItemFields(testDb(), owner, t.id, f.id, { changes: { bookingStatus: "booked" }, base: { bookingStatus: "needs_booking" } }, NOW);
    expect(booked).toMatchObject({ bookingStatus: "booked", version: scheduled.version + 1 });
  });

  it("keeps an AI price unverified until the person changes it, and counts each save of an AI event once", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event({ plannedPrice: { amount: "40", currency: "USD", label: "estimate" } }));
    await testDb().updateTable("plan_items").set({ source: "ai", price_source: "ai" }).where("id", "=", i.id).execute();
    const notes = await updateItemFields(testDb(), owner, t.id, i.id, { changes: { notes: "Cash only" }, base: { notes: null } }, NOW);
    expect(notes.plannedPrice).toMatchObject({ amount: "40", source: "ai" });
    const priced = await updateItemFields(testDb(), owner, t.id, i.id, { changes: { plannedPrice: { amount: "45", currency: "USD", label: "estimate" } }, base: { plannedPrice: { amount: "40", currency: "USD", label: "estimate" } } }, NOW);
    expect(priced.plannedPrice).toMatchObject({ amount: "45", source: "owner" });
    expect((await counts()).ai_item_edited).toBe(2);
  });

  it("lets owners and editors save over the route; viewers get 403, strangers 404, others 401 or 403", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    await grant(t.id, editor, "accepted", "editor");
    await grant(t.id, viewer);

    session.actor = editor;
    const ok = await itemFields.PATCH(patch({ changes: { title: "Inari" }, base: { title: i.title } }), itemCtx(t.id, i.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(((await ok.json()) as { title: string }).title).toBe("Inari");
    const stale = await itemFields.PATCH(patch({ changes: { title: "Again" }, base: { title: i.title } }), itemCtx(t.id, i.id));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("field_conflict");
    expect((await itemFields.PATCH(patch({ changes: { title: "" }, base: { title: "Inari" } }), itemCtx(t.id, i.id))).status).toBe(422);
    expect((await itemFields.PATCH(patch({ changes: { source: "ai" }, base: { source: "manual" } }), itemCtx(t.id, i.id))).status).toBe(422);
    expect((await itemFields.PATCH(patch({ changes: { title: "X" }, base: { title: "Inari" } }, "https://evil.example"), itemCtx(t.id, i.id))).status).toBe(403);

    session.actor = viewer;
    expect((await itemFields.PATCH(patch({ changes: { title: "X" }, base: { title: "Inari" } }), itemCtx(t.id, i.id))).status).toBe(403);
    session.actor = stranger;
    expect((await itemFields.PATCH(patch({ changes: { title: "X" }, base: { title: "Inari" } }), itemCtx(t.id, i.id))).status).toBe(404);
    session.actor = null;
    expect((await itemFields.PATCH(patch({ changes: { title: "X" }, base: { title: "Inari" } }), itemCtx(t.id, i.id))).status).toBe(401);

    expect((await getTripDetail(testDb(), owner, t.id, NOW)).items[0]!.title).toBe("Inari");
  });
});

describe("trip field saves (DASH-6)", () => {
  it("saves a field after the trip's events changed, which a full edit at the old version would refuse", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const opened = (await getTripDetail(testDb(), owner, t.id, NOW)).trip;
    await createItem(testDb(), owner, t.id, event());
    const saved = await updateTripFields(testDb(), owner, t.id, { changes: { budget: { amount: "4000", currency: "USD" } }, base: { budget: tripFieldsOf(opened).budget } }, NOW);
    expect(saved.title).toBe(tripInput.title);
    const now = (await getTripDetail(testDb(), owner, t.id, NOW)).trip;
    expect(now.budget).toEqual({ amount: "4000", currency: "USD" });
  });

  it("refuses a field changed elsewhere and a merged trip that doesn't make sense", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    await updateTripFields(testDb(), owner, t.id, { changes: { title: "Theirs" }, base: { title: tripInput.title } }, NOW);
    await expect(updateTripFields(testDb(), owner, t.id, { changes: { title: "Mine" }, base: { title: tripInput.title } }, NOW)).rejects.toMatchObject({ status: 409, code: "field_conflict" });
    await expect(updateTripFields(testDb(), owner, t.id, { changes: { endDate: "2026-11-01" }, base: { endDate: tripInput.endDate } }, NOW)).rejects.toMatchObject({ status: 422 });
  });

  it("sets and clears the globe point, and still asks before a time-zone change", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const opened = tripFieldsOf((await getTripDetail(testDb(), owner, t.id, NOW)).trip);
    await updateTripFields(testDb(), owner, t.id, { changes: { atlasLocation: { latitude: 35.0116, longitude: 135.7681 } }, base: { atlasLocation: opened.atlasLocation } }, NOW);
    let trip = (await getTripDetail(testDb(), owner, t.id, NOW)).trip;
    expect(trip.atlasLocation).toMatchObject({ latitude: 35.0116, longitude: 135.7681, source: "owner" });
    await updateTripFields(testDb(), owner, t.id, { changes: { atlasLocation: null }, base: { atlasLocation: { latitude: 35.0116, longitude: 135.7681 } } }, NOW);
    trip = (await getTripDetail(testDb(), owner, t.id, NOW)).trip;
    expect(trip.atlasLocation).toBeNull();
    await expect(updateTripFields(testDb(), owner, t.id, { changes: { timeZone: "America/New_York" }, base: { timeZone: "Asia/Tokyo" } }, NOW)).rejects.toMatchObject({ status: 409, code: "time_zone_confirmation_required" });
    await updateTripFields(testDb(), owner, t.id, { changes: { timeZone: "America/New_York" }, base: { timeZone: "Asia/Tokyo" }, confirmTimeZoneImpact: true }, NOW);
    expect((await getTripDetail(testDb(), owner, t.id, NOW)).trip.timeZone).toBe("America/New_York");
  });

  it("is for owners only over the route", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    await grant(t.id, editor, "accepted", "editor");
    session.actor = owner;
    expect((await tripFields.PATCH(patch({ changes: { title: "Autumn" }, base: { title: tripInput.title } }), tripCtx(t.id))).status).toBe(200);
    expect((await tripFields.PATCH(patch({ changes: {}, base: {} }), tripCtx(t.id))).status).toBe(422);
    session.actor = editor;
    expect((await tripFields.PATCH(patch({ changes: { title: "Editor" }, base: { title: "Autumn" } }), tripCtx(t.id))).status).toBe(403);
    session.actor = stranger;
    expect((await tripFields.PATCH(patch({ changes: { title: "Eve" }, base: { title: "Autumn" } }), tripCtx(t.id))).status).toBe(404);
  });
});
