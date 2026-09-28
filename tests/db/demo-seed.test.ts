import { beforeEach, describe, expect, it } from "vitest";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { listInvitations } from "@/server/modules/invitations/invitations.service";
import { getTripDetail } from "@/server/modules/trips/trips.service";
import { actorFor } from "@/server/auth/actor";
import { flightReadyToBook } from "@/shared/booking";
import { HAWAII_TITLE, KYOTO_TITLE, LISBON_TITLE, seedDemoTrips, TEST_FRIEND } from "../../scripts/demo-trips";
import { makeActor, reset, testDb } from "./helpers";

const NOW = new Date("2026-09-28T20:00:00Z"); // 28 Sep in Hawaii

let owner: Awaited<ReturnType<typeof makeActor>>;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Owner");
});

async function seed() {
  const { trips } = await seedDemoTrips(testDb(), { id: owner.userId, email: owner.email }, NOW);
  return Object.fromEntries(trips.map((t) => [t.title, t.id]));
}

describe("test trips seed", () => {
  it("builds a Hawaii trip that covers every trip-page state", async () => {
    const ids = await seed();
    const detail = await getTripDetail(testDb(), owner, ids[HAWAII_TITLE]!, NOW);
    const items = detail.items;

    expect(detail.trip).toMatchObject({ status: "upcoming", daysToStart: 21, dayCount: 8, role: "owner", atlasLocation: { source: "owner" } });
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(["flight", "lodging", "transport", "meal", "activity", "other"]));

    // Timeline sections: timed, date-only, undated, undated flight, flight placeholder, outside the trip.
    expect(items.some((i) => i.localTime)).toBe(true);
    expect(items.some((i) => i.type !== "flight" && i.localDate && !i.localTime)).toBe(true);
    expect(items.some((i) => i.type !== "flight" && !i.localDate)).toBe(true);
    expect(items.some((i) => i.type === "flight" && !i.timelineDate)).toBe(true);
    expect(items.some((i) => i.flightDetails?.plannedDepartureDate)).toBe(true);
    expect(items.some((i) => i.timelineDate && i.timelineDate < detail.trip.startDate)).toBe(true);
    expect(items.some((i) => i.timeZone && i.timeZone !== detail.trip.timeZone)).toBe(true);

    // Map pins from each provider and pasted coordinates, airport pins, and unpinned links.
    const pinned = items.filter((i) => i.coordinates?.source === "map_link");
    expect(pinned.length).toBeGreaterThanOrEqual(7);
    expect(new Set(pinned.map((i) => i.mapProvider))).toEqual(new Set(["Google Maps", "Apple Maps", "OpenStreetMap"]));
    expect(items.some((i) => i.coordinates?.source === "airport")).toBe(true);
    // At least one day has three or more pins, so the multi-stop road route can be checked.
    const pinsByDay = new Map<string, number>();
    for (const i of items) if (i.coordinates && i.timelineDate) pinsByDay.set(i.timelineDate, (pinsByDay.get(i.timelineDate) ?? 0) + 1);
    expect(Math.max(...pinsByDay.values())).toBeGreaterThanOrEqual(3);
    const unpinned = items.filter((i) => i.mapUrl && !i.coordinates).map((i) => i.mapProvider);
    expect(unpinned).toEqual(expect.arrayContaining(["Google Maps", "maps.google.com.example.net"]));
    expect(items.find((i) => i.title.startsWith("Check in: Outrigger"))?.mapUrl).not.toMatch(/entry=|g_ep=/);

    // Booking: every due state plus tasks without a date; AI provenance and price states.
    expect(new Set(items.map((i) => i.bookingDueState).filter(Boolean))).toEqual(new Set(["overdue", "due_today", "upcoming"]));
    expect(items.some((i) => i.bookingStatus === "needs_booking" && !i.bookingDueDate)).toBe(true);
    expect(new Set(items.map((i) => i.bookingStatus))).toEqual(new Set(["not_required", "needs_booking", "booked"]));
    expect(items.some((i) => i.source === "ai" && i.plannedPrice?.source === "ai")).toBe(true);
    expect(items.some((i) => i.source === "ai" && i.plannedPrice?.source === "owner")).toBe(true);
    expect(new Set(items.map((i) => i.plannedPrice?.label).filter(Boolean))).toEqual(new Set(["estimate", "quote"]));
    expect(items.some((i) => i.plannedPrice?.amount && Number(i.plannedPrice.amount) === 0)).toBe(true);
    // Flights still to book: one with its FLIGHT-2 fields (Mark booked offered) and placeholders without.
    const flightsToBook = items.filter((i) => i.flightDetails && i.bookingStatus === "needs_booking");
    expect(flightsToBook.some((i) => flightReadyToBook(i.flightDetails!))).toBe(true);
    expect(flightsToBook.some((i) => !flightReadyToBook(i.flightDetails!))).toBe(true);

    // Costs: two currencies kept apart, under budget in USD.
    expect(detail.plannedTotals.map((t) => t.currency).sort()).toEqual(["EUR", "USD"]);
    expect(detail.budgetComparison).toMatchObject({ currency: "USD", over: false });
    expect(detail.plannedTotals.find((t) => t.currency === "USD")!.unverifiedCount).toBeGreaterThan(0);

  });

  it("adds sharing entries in every state, a shared trip, a past trip over budget and an empty trip", async () => {
    const ids = await seed();
    const invitations = await listInvitations(testDb(), owner, ids[HAWAII_TITLE]!, NOW);
    expect(invitations.map((i) => i.status).sort()).toEqual(["accepted", "expired", "pending", "revoked"]);

    const dash = await getDashboard(testDb(), owner, NOW);
    const byTitle = Object.fromEntries(dash.trips.map((t) => [t.title, t]));
    expect(byTitle[KYOTO_TITLE]).toMatchObject({ role: "viewer", status: "past", ownerName: TEST_FRIEND.name, atlasLocation: { source: "catalog" } });
    expect(byTitle[LISBON_TITLE]).toMatchObject({ role: "owner", status: "upcoming", atlasLocation: null });
    expect(new Set(dash.ownerBookingTasks.map((t) => t.state))).toEqual(new Set(["overdue", "due_today", "upcoming", "no_due_date"]));

    const kyoto = await getTripDetail(testDb(), owner, ids[KYOTO_TITLE]!, NOW);
    expect(kyoto.trip.role).toBe("viewer");
    expect(kyoto.budgetComparison).toMatchObject({ currency: "JPY", over: true });
    expect((await getTripDetail(testDb(), owner, ids[LISBON_TITLE]!, NOW)).items).toHaveLength(0);

    const friend = await testDb().selectFrom("User").select(["id", "email"]).where("email", "=", TEST_FRIEND.email).executeTakeFirstOrThrow();
    const asFriend = await getTripDetail(testDb(), actorFor(friend), ids[HAWAII_TITLE]!, NOW);
    expect(asFriend.trip.role).toBe("viewer");
  });

  it("replaces its own trips on a re-run and leaves the owner's other trips alone", async () => {
    const mine = await testDb().insertInto("trips").values({
      owner_user_id: owner.userId, title: "My real trip", destination: "Paris, France", start_date: "2027-01-01", end_date: "2027-01-03",
      time_zone: "Europe/Paris", budget_amount: null, budget_currency: null, atlas_latitude: null, atlas_longitude: null, atlas_source: null,
    }).returning("id").executeTakeFirstOrThrow();
    await seed();
    await seed();
    const trips = await testDb().selectFrom("trips").select(["id", "title"]).execute();
    expect(trips.map((t) => t.title).sort()).toEqual([HAWAII_TITLE, KYOTO_TITLE, LISBON_TITLE, "My real trip"].sort());
    expect(trips.find((t) => t.title === "My real trip")?.id).toBe(mine.id);
    const users = await testDb().selectFrom("User").select("email").where("email", "=", TEST_FRIEND.email).execute();
    expect(users).toHaveLength(1);
  });
});
