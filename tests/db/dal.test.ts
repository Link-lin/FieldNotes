import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { event, flight, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip, deleteTrip, getTripDetail, updateTrip } from "@/server/modules/trips/trips.service";
import { previewTimeZone } from "@/server/modules/trips/time-zone.service";
import { recentCurrencies } from "@/server/modules/trips/budget.repository";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { deleteAccount } from "@/server/modules/account/account.service";
import { createItem, deleteItem, duplicateItem, restoreItem, updateItem, ITEM_CAP } from "@/server/modules/items/items.service";
import { HttpError } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";

const db = () => testDb();
async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
  return err as HttpError;
}

let owner: Actor, other: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  other = await makeActor("second-owner@example.com", "Maya");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
});

describe("authorization boundary", () => {
  it("lets only allowlisted identities create trips", async () => {
    await expectHttp(createTrip(db(), viewer, tripInput), 403);
    const t = await createTrip(db(), owner, tripInput, NOW);
    expect(t.role).toBe("owner");
    expect(t.atlasLocation?.source).toBe("catalog");
  });

  it("shows owned trips and accepted shares only", async () => {
    const mine = await createTrip(db(), owner, tripInput, NOW);
    const theirs = await createTrip(db(), other, { ...tripInput, title: "Iceland ring road", destination: "Reykjavik, Iceland" }, NOW);
    const pendingTrip = await createTrip(db(), other, { ...tripInput, title: "Pending" }, NOW);
    const revokedTrip = await createTrip(db(), other, { ...tripInput, title: "Revoked" }, NOW);
    await grant(theirs.id, owner);
    await grant(pendingTrip.id, owner, "pending");
    await grant(revokedTrip.id, owner, "revoked");
    const d = await getDashboard(db(), owner, NOW);
    expect(d.trips.map((t) => [t.title, t.role])).toEqual([
      ["Kyoto & Tokyo", "owner"],
      ["Iceland ring road", "viewer"],
    ]);
    expect(d.trips.find((t) => t.id === theirs.id)?.ownerName).toBe("Maya");
    expect((await getDashboard(db(), stranger, NOW)).trips).toEqual([]);
    expect(mine.id).toBeTruthy();
  });

  it("returns 404 to strangers and 403 to viewers who try to write", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    await grant(t.id, viewer);
    await expectHttp(getTripDetail(db(), stranger, t.id, NOW), 404);
    await expectHttp(getTripDetail(db(), stranger, "not-a-uuid", NOW), 404);
    expect((await getTripDetail(db(), viewer, t.id, NOW)).trip.role).toBe("viewer");
    await expectHttp(createItem(db(), viewer, t.id, event()), 403);
    await expectHttp(createItem(db(), stranger, t.id, event()), 404);
    await expectHttp(deleteTrip(db(), viewer, t.id, 1), 403);
  });

  it("blocks an owner removed from the allowlist on the next request", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const demoted = { ...owner, isOwner: false };
    await expectHttp(getTripDetail(db(), demoted, t.id, NOW), 404);
    expect((await getDashboard(db(), demoted, NOW)).trips).toEqual([]);
  });
});

describe("trip status and summaries", () => {
  it("derives status and counters from the trip time zone", async () => {
    const ongoing = await createTrip(db(), owner, { ...tripInput, startDate: "2026-09-22", endDate: "2026-09-29", timeZone: "Europe/Lisbon" }, NOW);
    expect([ongoing.status, ongoing.dayIndex, ongoing.dayCount]).toEqual(["ongoing", 5, 8]);
    const up = await createTrip(db(), owner, tripInput, NOW);
    expect([up.status, up.daysToStart]).toEqual(["upcoming", 50]);
    // 26 Sep 12:00 UTC is already 27 Sep in Kiritimati (UTC+14).
    const edge = await createTrip(db(), owner, { ...tripInput, startDate: "2026-09-27", endDate: "2026-09-27", timeZone: "Pacific/Kiritimati" }, NOW);
    expect(edge.status).toBe("ongoing");
  });
});

describe("items, money and map links", () => {
  it("stores the JSON v1 flight-field limits so imported flights remain editable", async () => {
    const trip = await createTrip(db(), owner, tripInput, NOW);
    const item = await createItem(db(), owner, trip.id, flight({
      airline: "A".repeat(120),
      flightNumber: "F".repeat(24),
      departure: { airportCode: "KSFO", localDateTime: null, timeZone: null, timeDisambiguation: null },
      arrival: { airportCode: "RJTT", localDateTime: null, timeZone: null, timeDisambiguation: null },
    }));
    expect(item.flightDetails).toMatchObject({
      airline: "A".repeat(120),
      flightNumber: "F".repeat(24),
      departure: { airportCode: "KSFO" },
      arrival: { airportCode: "RJTT" },
    });
  });

  it("keeps money exact and never combines currencies", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "0.1", currency: "USD", label: "estimate" } }));
    await createItem(db(), owner, t.id, event({ type: "meal", plannedPrice: { amount: "0.2", currency: "USD", label: "quote" } }));
    await createItem(db(), owner, t.id, event({ type: "lodging", plannedPrice: { amount: "48000", currency: "JPY", label: "estimate" } }));
    await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "3499.7", currency: "USD", label: "estimate" } }));
    const d = await getTripDetail(db(), owner, t.id, NOW);
    const usd = d.plannedTotals.find((x) => x.currency === "USD")!;
    expect(usd.total).toBe("3500");
    expect(usd.byType).toEqual(expect.arrayContaining([{ type: "meal", amount: "0.2" }]));
    expect(d.plannedTotals.find((x) => x.currency === "JPY")?.total).toBe("48000");
    expect(d.budgetComparison).toEqual({ currency: "USD", budget: "3500", planned: "3500", remaining: "0", over: false });
    await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "0.0001", currency: "USD", label: "estimate" } }));
    const d2 = await getTripDetail(db(), owner, t.id, NOW);
    expect(d2.budgetComparison).toMatchObject({ over: true, remaining: "0.0001" });
  });

  it("pins a stop only from a changed, parseable map link", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event({ mapUrl: "https://www.google.com/maps/place/X/@34.9671,135.7727,17z?entry=ttu" }));
    expect(a.coordinates).toEqual({ latitude: 34.9671, longitude: 135.7727, source: "map_link" });
    expect(a.mapUrl).toBe("https://www.google.com/maps/place/X/@34.9671,135.7727,17z");
    expect(a.mapProvider).toBe("Google Maps");
    const spoof = await createItem(db(), owner, t.id, event({ mapUrl: "https://google.com.evil.example/maps/@35.1,139.1,15z" }));
    expect(spoof.coordinates).toBeNull();
    expect(spoof.mapProvider).toBe("google.com.evil.example");
    await expectHttp(createItem(db(), owner, t.id, event({ mapUrl: "http://www.google.com/maps/@35,139,15z" })), 422);

    // Simulate a stored link without coordinates: re-sending the same link must not re-pin.
    await db().updateTable("plan_items").set({ latitude: null, longitude: null }).where("id", "=", a.id).execute();
    const cur = (await getTripDetail(db(), owner, t.id, NOW)).items.find((i) => i.id === a.id)!;
    const edited = await updateItem(db(), owner, t.id, a.id, { item: event({ title: "Renamed", mapUrl: cur.mapUrl }), expectedVersion: cur.version });
    expect(edited.coordinates).toBeNull();
  });

  it("keeps an AI price unverified until the owner changes it", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const [row] = await db()
      .insertInto("plan_items")
      .values({ trip_id: t.id, type: "lodging", title: "Ryokan", source: "ai", booking_status: "needs_booking", links: "[]", planned_amount: "48000", planned_currency: "JPY", price_label: "estimate", price_source: "ai", local_date: "2026-11-17" })
      .returning(["id", "version"])
      .execute();
    const same = event({ type: "lodging", title: "Ryokan, 2 nights", localTime: null, bookingStatus: "needs_booking", plannedPrice: { amount: "48000.00", currency: "JPY", label: "estimate" } });
    const kept = await updateItem(db(), owner, t.id, row!.id, { item: same, expectedVersion: row!.version });
    expect(kept.plannedPrice?.source).toBe("ai");
    expect(kept.source).toBe("ai");
    const changed = await updateItem(db(), owner, t.id, row!.id, { item: { ...same, plannedPrice: { amount: "52000", currency: "JPY", label: "quote" } } as never, expectedVersion: kept.version });
    expect(changed.plannedPrice).toEqual({ amount: "52000", currency: "JPY", label: "quote", source: "owner" });
    const d = await getTripDetail(db(), owner, t.id, NOW);
    expect(d.plannedTotals[0]?.unverifiedCount).toBe(0);
  });

  it("soft-deletes, restores within 10 minutes, and refuses later", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "10", currency: "USD", label: "estimate" } }));
    await expectHttp(deleteItem(db(), owner, t.id, a.id, a.version + 5), 409);
    await deleteItem(db(), owner, t.id, a.id, a.version);
    let d = await getTripDetail(db(), owner, t.id, NOW);
    expect(d.items).toHaveLength(0);
    expect(d.plannedTotals).toEqual([]);
    const back = await restoreItem(db(), owner, t.id, a.id, new Date());
    expect(back.id).toBe(a.id);
    expect(back.source).toBe("manual");
    d = await getTripDetail(db(), owner, t.id, NOW);
    expect(d.items.map((i) => i.id)).toEqual([a.id]);
    await deleteItem(db(), owner, t.id, a.id, back.version);
    await expectHttp(restoreItem(db(), owner, t.id, a.id, new Date(Date.now() + 11 * 60_000)), 410);
    await expectHttp(restoreItem(db(), viewer, t.id, a.id), 404);
  });

  it("rejects stale versions and unconfirmed type changes", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event());
    await updateItem(db(), owner, t.id, a.id, { item: event({ title: "One" }), expectedVersion: a.version });
    await expectHttp(updateItem(db(), owner, t.id, a.id, { item: event({ title: "Two" }), expectedVersion: a.version }), 409, "version_conflict");
    const cur = (await getTripDetail(db(), owner, t.id, NOW)).items[0]!;
    await expectHttp(updateItem(db(), owner, t.id, a.id, { item: flight(), expectedVersion: cur.version }), 409, "type_change_confirmation_required");
    const f = await updateItem(db(), owner, t.id, a.id, { item: flight(), expectedVersion: cur.version, confirmTypeChange: true });
    expect([f.type, f.localDate, f.bookingStatus]).toEqual(["flight", null, "needs_booking"]);
  });

  it("enforces the 250-event cap", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const rows = Array.from({ length: ITEM_CAP }, (_, i) => ({ trip_id: t.id, type: "other" as const, title: `E${i}`, source: "manual" as const, booking_status: "not_required" as const, links: "[]" }));
    await db().insertInto("plan_items").values(rows).execute();
    await expectHttp(createItem(db(), owner, t.id, event()), 409, "item_cap");
  });

  it("validates daylight-saving times and flight order", async () => {
    const t = await createTrip(db(), owner, { ...tripInput, timeZone: "America/New_York", startDate: "2027-03-10", endDate: "2027-11-10" }, NOW);
    const gap = await expectHttp(createItem(db(), owner, t.id, event({ localDate: "2027-03-14", localTime: "02:30" })), 422);
    expect(gap.fields?.[0]?.code).toBe("nonexistent_local_time");
    const amb = await expectHttp(createItem(db(), owner, t.id, event({ localDate: "2027-11-07", localTime: "01:30" })), 422);
    expect(amb.fields?.[0]).toMatchObject({ code: "ambiguous_local_time", path: "timeDisambiguation" });
    const ok = await createItem(db(), owner, t.id, event({ localDate: "2027-11-07", localTime: "01:30", timeDisambiguation: "later" }));
    expect(ok.sortInstant).toBe("2027-11-07T06:30:00.000Z");
    const f = (dep: string, arr: string) =>
      flight({
        bookingStatus: "booked",
        departure: { airportCode: "SFO", localDateTime: dep, timeZone: "America/Los_Angeles", timeDisambiguation: null },
        arrival: { airportCode: "HND", localDateTime: arr, timeZone: "Asia/Tokyo", timeDisambiguation: null },
      });
    await expectHttp(createItem(db(), owner, t.id, f("2027-04-15T13:40", "2027-04-15T13:40")), 422);
    const good = await createItem(db(), owner, t.id, f("2027-04-15T13:40", "2027-04-16T17:20"));
    expect(good.timelineDate).toBe("2027-04-15");
    expect(good.coordinates?.source).toBe("airport");
  });

  it("does not pin an AI flight placeholder from its airport code", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    await db()
      .insertInto("plan_items")
      .values({ trip_id: t.id, type: "flight", title: "Flight to Tokyo", source: "ai", booking_status: "needs_booking", links: "[]", arrival_airport_code: "HND", planned_departure_date: "2026-11-15" })
      .execute();
    const d = await getTripDetail(db(), owner, t.id, NOW);
    expect(d.items[0]?.coordinates).toBeNull();
  });

  it("duplicates a booked item as needing booking with no due date", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event({ bookingStatus: "booked" }));
    const copy = await duplicateItem(db(), owner, t.id, a.id, a.version);
    expect([copy.bookingStatus, copy.bookingDueDate, copy.title]).toEqual(["needs_booking", null, a.title]);
  });
});

describe("booking tasks", () => {
  it("lists every needs-booking item for owners, with due states from the trip zone", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    await createItem(db(), owner, t.id, event({ title: "Overdue", bookingStatus: "needs_booking", bookingDueDate: "2026-09-20" }));
    await createItem(db(), owner, t.id, event({ title: "No date", bookingStatus: "needs_booking" }));
    await createItem(db(), owner, t.id, event({ title: "Today", bookingStatus: "needs_booking", bookingDueDate: "2026-09-26" }));
    const d = await getDashboard(db(), owner, NOW);
    expect(d.ownerBookingTasks.map((x) => [x.itemTitle, x.state])).toEqual([
      ["Overdue", "overdue"],
      ["Today", "due_today"],
      ["No date", "no_due_date"],
    ]);
    await grant(t.id, viewer);
    expect((await getDashboard(db(), viewer, NOW)).ownerBookingTasks).toEqual([]);
  });
});

describe("trip edits and deletion", () => {
  it("rematches catalog points, keeps owner points, and applies explicit edits", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    let s = await updateTrip(db(), owner, t.id, { ...tripInput, destination: "Somewhere unknown", expectedVersion: 1 });
    expect(s.atlasLocation).toBeNull();
    s = await updateTrip(db(), owner, t.id, { ...tripInput, expectedVersion: 2, atlasLocation: { latitude: -54.8, longitude: -68.3 } });
    expect(s.atlasLocation).toEqual({ latitude: -54.8, longitude: -68.3, source: "owner" });
    s = await updateTrip(db(), owner, t.id, { ...tripInput, destination: "Lisbon, Portugal", expectedVersion: 3 });
    expect(s.atlasLocation?.source).toBe("owner");
    await expectHttp(updateTrip(db(), owner, t.id, { ...tripInput, expectedVersion: 3 }), 409);
  });

  it("requires confirmation and choices before changing the trip time zone", async () => {
    const t = await createTrip(db(), owner, { ...tripInput, timeZone: "Asia/Tokyo", startDate: "2027-11-01", endDate: "2027-11-10" }, NOW);
    const item = await createItem(db(), owner, t.id, event({ localDate: "2027-11-07", localTime: "01:30" }));
    const detail = await getTripDetail(db(), owner, t.id, NOW);
    const patch = { ...tripInput, startDate: "2027-11-01", endDate: "2027-11-10", timeZone: "America/New_York", expectedVersion: detail.trip.version };
    const preview = await previewTimeZone(db(), owner, t.id, "America/New_York", detail.trip.version);
    expect(preview.items).toEqual([expect.objectContaining({ itemId: item.id, result: "ambiguous" })]);
    await expectHttp(updateTrip(db(), owner, t.id, patch), 409, "time_zone_confirmation_required");
    await expectHttp(updateTrip(db(), owner, t.id, { ...patch, confirmTimeZoneImpact: true }), 422);
    await updateTrip(db(), owner, t.id, { ...patch, confirmTimeZoneImpact: true, timeDisambiguationByItem: { [item.id]: "earlier" } });
    const after = await getTripDetail(db(), owner, t.id, NOW);
    expect(after.items[0]).toMatchObject({ timeDisambiguation: "earlier", sortInstant: "2027-11-07T05:30:00.000Z", localTime: "01:30" });
  });

  it("deletes a trip with its items and shares, clearing import receipts", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    await createItem(db(), owner, t.id, event());
    await grant(t.id, viewer);
    await db().insertInto("import_receipts").values({ owner_user_id: owner.userId, idempotency_key: crypto.randomUUID(), payload_hash: Buffer.from("x"), trip_id: t.id }).execute();
    const d = await getTripDetail(db(), owner, t.id, NOW);
    await expectHttp(deleteTrip(db(), owner, t.id, d.trip.version - 1), 409);
    await deleteTrip(db(), owner, t.id, d.trip.version);
    expect(await db().selectFrom("plan_items").selectAll().execute()).toEqual([]);
    expect(await db().selectFrom("trip_viewers").selectAll().execute()).toEqual([]);
    expect(await db().selectFrom("import_receipts").select(["trip_id", "payload_hash"]).execute()).toEqual([{ trip_id: null, payload_hash: null }]);
  });

  it("deletes an account with its owned trips but not other owners' trips", async () => {
    const mine = await createTrip(db(), owner, tripInput, NOW);
    const theirs = await createTrip(db(), other, tripInput, NOW);
    await grant(theirs.id, owner);
    await deleteAccount(db(), owner);
    const left = await db().selectFrom("trips").select("id").execute();
    expect(left.map((r) => r.id)).toEqual([theirs.id]);
    expect(await db().selectFrom("trip_viewers").selectAll().execute()).toEqual([]);
    expect(mine.id).not.toBe(theirs.id);
    const users = await sql<{ n: number }>`select count(*)::int as n from "User"`.execute(db());
    expect(users.rows[0]!.n).toBe(3);
  });
});

describe("review fixes", () => {
  it("won't restore an event whose time no longer exists or repeats in the new trip zone", async () => {
    const t = await createTrip(db(), owner, { ...tripInput, startDate: "2027-11-01", endDate: "2027-11-10" }, NOW);
    const a = await createItem(db(), owner, t.id, event({ localDate: "2027-11-07", localTime: "01:30" }));
    await deleteItem(db(), owner, t.id, a.id, a.version);
    const v = (await getTripDetail(db(), owner, t.id, NOW)).trip.version;
    await updateTrip(db(), owner, t.id, { ...tripInput, startDate: "2027-11-01", endDate: "2027-11-10", timeZone: "America/New_York", expectedVersion: v, confirmTimeZoneImpact: true });
    await expectHttp(restoreItem(db(), owner, t.id, a.id, new Date()), 409, "restore_time_invalid");
  });

  it("previews how book-by states change with the zone", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    // 2026-09-26T12:00Z is the 26th in both zones; 23:30Z is the 27th in Tokyo but the 26th in Los Angeles.
    const late = new Date("2026-09-26T23:30:00Z");
    await createItem(db(), owner, t.id, event({ bookingStatus: "needs_booking", bookingDueDate: "2026-09-27" }));
    await createItem(db(), owner, t.id, event({ title: "No date", bookingStatus: "needs_booking", bookingDueDate: null }));
    const v = (await getTripDetail(db(), owner, t.id, NOW)).trip.version;
    const p = await previewTimeZone(db(), owner, t.id, "America/Los_Angeles", v, late);
    expect(p.bookingTasks).toEqual([expect.objectContaining({ dueDate: "2026-09-27", before: "due_today", after: "upcoming" })]);
  });

  it("purges expired deletions on other writes too", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event());
    const b = await createItem(db(), owner, t.id, event({ title: "Second" }));
    await deleteItem(db(), owner, t.id, a.id, a.version);
    await sql`update plan_items set deleted_at = now() - interval '11 minutes' where id = ${a.id}`.execute(db());
    await deleteItem(db(), owner, t.id, b.id, b.version);
    const left = await db().selectFrom("plan_items").select("id").execute();
    expect(left.map((r) => r.id)).toEqual([b.id]);
  });

  it("keeps an AI price unverified when the same amount is re-sent with different trailing zeros", async () => {
    const t = await createTrip(db(), owner, tripInput, NOW);
    const a = await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "12.5", currency: "USD", label: "estimate" } }));
    await db().updateTable("plan_items").set({ price_source: "ai" }).where("id", "=", a.id).execute();
    const cur = (await getTripDetail(db(), owner, t.id, NOW)).items[0]!;
    const saved = await updateItem(db(), owner, t.id, a.id, { item: event({ plannedPrice: { amount: "12.50", currency: "USD", label: "estimate" } }), expectedVersion: cur.version, confirmTypeChange: false });
    expect(saved.plannedPrice?.source).toBe("ai");
  });

  it("stores canonical time-zone spelling", async () => {
    const { tripInputSchema } = await import("@/shared/schemas");
    const parsed = tripInputSchema.parse({ ...tripInput, timeZone: "asia/tokyo" });
    expect(parsed.timeZone).toBe("Asia/Tokyo");
  });
});

describe("recent currencies", () => {
  it("lists the owner's currencies, most recently used first, and nothing for viewers", async () => {
    const t = await createTrip(db(), owner, { ...tripInput, budget: { amount: "100", currency: "USD" } }, NOW);
    await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "10", currency: "JPY", label: "estimate" } }));
    const eur = await createItem(db(), owner, t.id, event({ plannedPrice: { amount: "5", currency: "EUR", label: "quote" } }));
    await sql`update trips set created_at = now() - interval '2 days'`.execute(db());
    await sql`update plan_items set updated_at = now() - interval '1 day' where id <> ${eur.id}`.execute(db());
    expect(await recentCurrencies(db(), owner.userId)).toEqual(["EUR", "JPY", "USD"]);
    // A deleted price no longer counts.
    await deleteItem(db(), owner, t.id, eur.id, eur.version);
    expect(await recentCurrencies(db(), owner.userId)).toEqual(["JPY", "USD"]);
    await grant(t.id, viewer);
    expect((await getTripDetail(db(), viewer, t.id, NOW)).recentCurrencies).toEqual([]);
    expect((await getDashboard(db(), owner, NOW)).recentCurrencies[0]).toBe("JPY");
  });
});
