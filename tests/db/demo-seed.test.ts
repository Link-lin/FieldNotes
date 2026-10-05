import { beforeEach, describe, expect, it } from "vitest";
import { listOwnedTrips } from "@/server/modules/account/account.service";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { listInvitations } from "@/server/modules/invitations/invitations.service";
import { getTripDetail } from "@/server/modules/trips/trips.service";
import { actorFor } from "@/server/auth/actor";
import { flightReadyToBook } from "@/shared/booking";
import { upNext } from "@/features/trips/TripPage/trip-days";
import { HAWAII_TITLE, KAUAI_TITLE, KYOTO_TITLE, LISBON_TITLE, OSAKA_TITLE, SEOUL_TITLE, seedDemoTrips, TEST_FRIEND } from "../../scripts/demo-trips";
import { makeActor, reset, testDb } from "./helpers";

const NOW = new Date("2026-09-28T20:00:00Z"); // 28 Sep in Hawaii

let owner: Awaited<ReturnType<typeof makeActor>>;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Owner");
});

async function seed() {
  const { trips } = await seedDemoTrips(testDb(), { id: owner.userId, email: owner.email! }, NOW);
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
    expect(items.some((i) => i.flightDetails && !i.flightDetails.departure.airportCode && !i.flightDetails.arrival.airportCode)).toBe(true);
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
    // A return visit: two events on different days at exactly the same point.
    const points = items.filter((i) => i.coordinates?.source === "map_link" && i.timelineDate).map((i) => `${i.coordinates!.latitude},${i.coordinates!.longitude}|${i.timelineDate}`);
    const byPoint = new Map<string, Set<string>>();
    for (const p of points) { const [at, day] = p.split("|") as [string, string]; byPoint.set(at, (byPoint.get(at) ?? new Set()).add(day)); }
    expect([...byPoint.values()].some((days) => days.size > 1)).toBe(true);
    const unpinned = items.filter((i) => i.mapUrl && !i.coordinates).map((i) => i.mapProvider);
    expect(unpinned).toEqual(expect.arrayContaining(["Google Maps", "maps.google.com.example.net"]));
    expect(items.find((i) => i.title.startsWith("Check in: Outrigger"))?.mapUrl).not.toMatch(/entry=|g_ep=/);

    // Booking: every due state plus tasks without a date; AI provenance and price states.
    expect(new Set(items.map((i) => i.bookingDueState).filter(Boolean))).toEqual(new Set(["overdue", "due_today", "upcoming"]));
    expect(items.some((i) => i.bookingStatus === "needs_booking" && !i.bookingDueDate)).toBe(true);
    expect(new Set(items.map((i) => i.bookingStatus))).toEqual(new Set(["not_required", "needs_booking", "booked"]));
    expect(items.some((i) => i.source === "ai" && i.plannedPrice?.source === "ai")).toBe(true);
    expect(items.some((i) => i.source === "ai" && i.plannedPrice?.source === "owner")).toBe(true);
    // AI drafts still to check, and ones the owner has marked reviewed: an event, and a flight now pinned at its arrival airport.
    expect(items.some((i) => i.source === "ai" && !i.reviewedAt)).toBe(true);
    expect(items.some((i) => i.source === "ai" && i.reviewedAt && !i.flightDetails)).toBe(true);
    expect(items.some((i) => i.source === "ai" && i.reviewedAt && i.flightDetails && i.coordinates?.source === "airport")).toBe(true);
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
    expect(invitations.map((i) => i.status).sort()).toEqual(["accepted", "expired", "pending", "pending", "revoked"]);
    // Every role appears in the sharing list: an accepted editor, a pending owner, an expired editor, a revoked viewer
    // and a pending invitation by link (no address, only a label).
    expect(invitations.map((i) => `${i.status}:${i.role}`).sort()).toEqual(["accepted:editor", "expired:editor", "pending:owner", "pending:viewer", "revoked:viewer"]);
    expect(invitations.filter((i) => i.email === null)).toEqual([expect.objectContaining({ label: "Mei, on WeChat (test)", status: "pending" })]);

    const dash = await getDashboard(testDb(), owner, NOW);
    const byTitle = Object.fromEntries(dash.trips.map((t) => [t.title, t]));
    expect(byTitle[KYOTO_TITLE]).toMatchObject({ role: "viewer", status: "past", ownerName: TEST_FRIEND.name, atlasLocation: { source: "catalog" } });
    expect(byTitle[LISBON_TITLE]).toMatchObject({ role: "owner", primaryOwner: true, status: "upcoming", atlasLocation: null });
    // Trips someone else made, with each role you can hold on them.
    expect(byTitle[KYOTO_TITLE]).toMatchObject({ role: "viewer", primaryOwner: false });
    expect(byTitle[OSAKA_TITLE]).toMatchObject({ role: "editor", primaryOwner: false, ownerName: TEST_FRIEND.name });
    expect(byTitle[SEOUL_TITLE]).toMatchObject({ role: "owner", primaryOwner: false, ownerName: TEST_FRIEND.name });
    // Booking counts cover the trips you can edit (yours, the editor trip and the co-owned one), never the viewer trip.
    const taskTrips = new Set(dash.ownerBookingTasks.map((t) => t.tripTitle));
    expect(taskTrips.has(OSAKA_TITLE) && taskTrips.has(SEOUL_TITLE) && taskTrips.has(HAWAII_TITLE)).toBe(true);
    expect(taskTrips.has(KYOTO_TITLE)).toBe(false);
    expect(new Set(dash.ownerBookingTasks.map((t) => t.state))).toEqual(new Set(["overdue", "due_today", "upcoming", "no_due_date"]));

    const kyoto = await getTripDetail(testDb(), owner, ids[KYOTO_TITLE]!, NOW);
    expect(kyoto.trip.role).toBe("viewer");
    expect(kyoto.budgetComparison).toMatchObject({ currency: "JPY", over: true });
    expect((await getTripDetail(testDb(), owner, ids[LISBON_TITLE]!, NOW)).items).toHaveLength(0);

    // Happening now: day 2 of 3, and Up next skips today's sunrise (10:00 in Hawaii) for tonight's dinner.
    expect(byTitle[KAUAI_TITLE]).toMatchObject({ role: "owner", status: "ongoing", dayIndex: 2, dayCount: 3 });
    const kauai = await getTripDetail(testDb(), owner, ids[KAUAI_TITLE]!, NOW);
    expect(upNext(kauai.trip, kauai.items, NOW.getTime())).toMatchObject({ item: { title: "Dinner at Hanalei Dolphin" }, label: "Today" });

    const friend = await testDb().selectFrom("User").select(["id", "email"]).where("email", "=", TEST_FRIEND.email).executeTakeFirstOrThrow();
    const asFriend = await getTripDetail(testDb(), actorFor(friend), ids[HAWAII_TITLE]!, NOW);
    expect(asFriend.trip.role).toBe("editor"); // Sam, the made-up friend, edits your Hawaii trip

    // Deleting your account would settle the trips you own three ways: Lisbon stays with its co-owner (Sam), Hawaii
    // asks who takes over (Sam is next in line), and Kauaʻi and Seoul have nobody else on them, so they would be deleted.
    const plans = Object.fromEntries((await listOwnedTrips(testDb(), owner)).map((p) => [p.title, p]));
    expect(Object.keys(plans).sort()).toEqual([HAWAII_TITLE, KAUAI_TITLE, LISBON_TITLE, SEOUL_TITLE].sort());
    expect(plans[LISBON_TITLE]).toMatchObject({ otherOwners: [TEST_FRIEND.email], people: [{ name: TEST_FRIEND.email, role: "owner" }] });
    expect(plans[HAWAII_TITLE]).toMatchObject({ otherOwners: [], people: [{ name: TEST_FRIEND.email, role: "editor" }] });
    expect(plans[KAUAI_TITLE]).toMatchObject({ otherOwners: [], people: [] });
    expect(plans[SEOUL_TITLE]).toMatchObject({ otherOwners: [], people: [] });
  });

  it("replaces its own trips on a re-run and leaves the owner's other trips alone", async () => {
    const mine = await testDb().insertInto("trips").values({
      owner_user_id: owner.userId, title: "My real trip", destination: "Paris, France", start_date: "2027-01-01", end_date: "2027-01-03",
      time_zone: "Europe/Paris", budget_amount: null, budget_currency: null, atlas_latitude: null, atlas_longitude: null, atlas_source: null,
    }).returning("id").executeTakeFirstOrThrow();
    await seed();
    await seed();
    const trips = await testDb().selectFrom("trips").select(["id", "title"]).execute();
    expect(trips.map((t) => t.title).sort()).toEqual([HAWAII_TITLE, KAUAI_TITLE, KYOTO_TITLE, LISBON_TITLE, OSAKA_TITLE, SEOUL_TITLE, "My real trip"].sort());
    expect(trips.find((t) => t.title === "My real trip")?.id).toBe(mine.id);
    const users = await testDb().selectFrom("User").select("email").where("email", "=", TEST_FRIEND.email).execute();
    expect(users).toHaveLength(1);
  });
});
