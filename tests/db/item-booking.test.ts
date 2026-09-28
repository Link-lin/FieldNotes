import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, flight, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import { createItem, updateItemBooking } from "@/server/modules/items/items.service";
import { HttpError } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";

// The route runs end to end with only the session lookup replaced.
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

const booking = await import("@/app/api/trips/[tripId]/items/[itemId]/booking/route");

const ORIGIN = "http://localhost:3000";
const patch = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/x`, { method: "PATCH", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const ctx = (tripId: string, itemId: string) => ({ params: Promise.resolve({ tripId, itemId }) });

async function counts(): Promise<Record<string, number>> {
  const rows = await testDb().selectFrom("usage_counts").select(["name", "count"]).execute();
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]));
}

const endpoint = (airportCode: string, localDateTime: string, timeZone: string) => ({ airportCode, localDateTime, timeZone, timeDisambiguation: null });

let owner: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  session.actor = null;
});

describe("booking-list actions (BOOK-3, BOOK-4)", () => {
  it("marks an event booked, clearing its book-by date, and Undo puts the date back", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event({ bookingStatus: "needs_booking", bookingDueDate: "2026-10-01", notes: "Ask for a window table" }));
    await testDb().updateTable("plan_items").set({ source: "ai" }).where("id", "=", i.id).execute(); // as if imported
    const tripVersion = (await getTripDetail(testDb(), owner, t.id, NOW)).trip.version;

    const booked = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "booked", bookingDueDate: null, expectedVersion: i.version }, NOW);
    expect(booked).toMatchObject({ bookingStatus: "booked", bookingDueDate: null, bookingDueState: null, version: i.version + 1, title: i.title, notes: i.notes, localTime: i.localTime });
    expect((await getTripDetail(testDb(), owner, t.id, NOW)).trip.version).toBe(tripVersion + 1);

    const back = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "needs_booking", bookingDueDate: "2026-10-01", expectedVersion: booked.version }, NOW);
    expect(back).toMatchObject({ bookingStatus: "needs_booking", bookingDueDate: "2026-10-01", bookingDueState: "upcoming" });
    // Booking-list actions count only the booking measures, never an edit of the (AI) item.
    expect(await counts()).toEqual({ manual_trip_created: 1, manual_item_created: 1, due_date_set: 2, item_booked: 1 });
  });

  it("sets, changes and clears a book-by date, counting only new or changed dates", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event({ bookingStatus: "needs_booking" }));
    const set = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "needs_booking", bookingDueDate: "2026-09-26", expectedVersion: i.version }, NOW);
    expect([set.bookingDueDate, set.bookingDueState]).toEqual(["2026-09-26", "due_today"]);
    const same = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "needs_booking", bookingDueDate: "2026-09-26", expectedVersion: set.version }, NOW);
    const moved = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "needs_booking", bookingDueDate: "2026-09-20", expectedVersion: same.version }, NOW);
    expect(moved.bookingDueState).toBe("overdue");
    const cleared = await updateItemBooking(testDb(), owner, t.id, i.id, { bookingStatus: "needs_booking", bookingDueDate: null, expectedVersion: moved.version }, NOW);
    expect([cleared.bookingStatus, cleared.bookingDueDate, cleared.bookingDueState]).toEqual(["needs_booking", null, null]);
    expect((await counts()).due_date_set).toBe(2);
  });

  it("books a flight only when both airports have their local times and zones (FLIGHT-2)", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const placeholder = await createItem(testDb(), owner, t.id, flight({ departure: endpoint("SFO", "2026-11-15T11:00", "America/Los_Angeles"), bookingDueDate: "2026-10-01" }));
    const err = await updateItemBooking(testDb(), owner, t.id, placeholder.id, { bookingStatus: "booked", bookingDueDate: null, expectedVersion: placeholder.version }, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 422, fields: [{ path: "bookingStatus", code: "flight_incomplete" }] });
    // Nothing changed, so the book-by date is still set.
    expect((await getTripDetail(testDb(), owner, t.id, NOW)).items[0]).toMatchObject({ bookingStatus: "needs_booking", bookingDueDate: "2026-10-01", version: placeholder.version });

    const complete = await createItem(testDb(), owner, t.id, flight({
      departure: endpoint("SFO", "2026-11-15T11:00", "America/Los_Angeles"),
      arrival: endpoint("HND", "2026-11-16T15:10", "Asia/Tokyo"),
      bookingDueDate: "2026-10-01",
    }));
    const booked = await updateItemBooking(testDb(), owner, t.id, complete.id, { bookingStatus: "booked", bookingDueDate: null, expectedVersion: complete.version }, NOW);
    expect([booked.bookingStatus, booked.bookingDueDate]).toEqual(["booked", null]);
  });

  it("is owner-only over the route, with version, body and Origin checks", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event({ bookingStatus: "needs_booking" }));
    await grant(t.id, viewer);
    const body = (over: Record<string, unknown> = {}) => ({ bookingStatus: "needs_booking", bookingDueDate: "2026-10-03", expectedVersion: i.version + 1, ...over });

    session.actor = owner;
    const ok = await booking.PATCH(patch(body({ expectedVersion: i.version })), ctx(t.id, i.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(((await ok.json()) as { bookingDueDate: string }).bookingDueDate).toBe("2026-10-03");
    expect((await booking.PATCH(patch(body({ expectedVersion: i.version })), ctx(t.id, i.id))).status).toBe(409);
    expect((await booking.PATCH(patch(body({ bookingStatus: "booked" })), ctx(t.id, i.id))).status).toBe(422);
    expect((await booking.PATCH(patch(body({ bookingStatus: "not_required", bookingDueDate: null })), ctx(t.id, i.id))).status).toBe(422);
    expect((await booking.PATCH(patch(body(), "https://evil.example"), ctx(t.id, i.id))).status).toBe(403);
    expect((await booking.PATCH(patch(body()), ctx(t.id, "not-a-uuid"))).status).toBe(404);

    session.actor = viewer;
    expect((await booking.PATCH(patch(body({ bookingStatus: "booked", bookingDueDate: null })), ctx(t.id, i.id))).status).toBe(403);
    session.actor = stranger;
    expect((await booking.PATCH(patch(body()), ctx(t.id, i.id))).status).toBe(404);
    session.actor = null;
    expect((await booking.PATCH(patch(body()), ctx(t.id, i.id))).status).toBe(401);

    expect((await getTripDetail(testDb(), owner, t.id, NOW)).items[0]).toMatchObject({ bookingStatus: "needs_booking", bookingDueDate: "2026-10-03" });
  });
});
