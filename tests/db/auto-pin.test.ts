import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { event, flight, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import type { Later } from "@/server/core/later";
import { appendAiItems, createTripByAi } from "@/server/modules/import/import.service";
import { itemInputOf } from "@/server/modules/items/items.ai";
import { createItem, getItem, updateItem, updateItemByAi } from "@/server/modules/items/items.service";
import { autoPin } from "@/server/modules/places/auto-pin.service";
import { findPlaceCandidates } from "@/server/modules/places/geocode.service";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import type { ImportLocationResult } from "@/shared/import";

const KINKAKUJI = { label: "Kinkaku-ji, Kyoto, Japan", latitude: 35.03937, longitude: 135.72924, confidence: 1, kind: "amenity" };
const clear = (c = KINKAKUJI): ImportLocationResult => ({ candidates: [c], suggestedIndex: 0 });
const unsure: ImportLocationResult = { candidates: [KINKAKUJI, { ...KINKAKUJI, latitude: 35.1 }], suggestedIndex: null };

/** Collects what a service hands to `later`, to run when the test says. */
function collector() {
  const tasks: Array<() => Promise<void>> = [];
  const later: Later = (task) => void tasks.push(task);
  return { later, tasks, run: async () => { for (const t of tasks.splice(0)) await t(); } };
}

let owner: Actor;
let tripId: string;
beforeEach(async () => {
  await reset();
  vi.stubEnv("GEOAPIFY_API_KEY", "test-key");
  owner = await makeActor("owner@example.com", "Link");
  tripId = (await createTrip(testDb(), owner, tripInput, NOW)).id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const version = async () => (await getTripDetail(testDb(), owner, tripId, NOW)).trip.version;

describe("automatic pins (MAP-2)", () => {
  it("pins an event at the one clear match for its place name, as an automatic OpenStreetMap pin", async () => {
    const i = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    const before = await version();
    const find = vi.fn(async () => clear());
    expect(await autoPin(testDb(), tripId, [i.id], find)).toBe(1);
    expect(find).toHaveBeenCalledWith("Kinkaku-ji, Kyoto", tripInput.destination, expect.objectContaining({ pace: expect.any(Function) }));
    const pinned = await getItem(testDb(), owner, tripId, i.id, NOW);
    expect(pinned).toMatchObject({ mapUrl: "https://www.openstreetmap.org/?mlat=35.03937&mlon=135.72924", mapProvider: "OpenStreetMap", coordinates: { latitude: 35.03937, longitude: 135.72924, source: "lookup" }, version: i.version + 1 });
    expect(await version()).toBe(before + 1);
  });

  it("leaves the event unpinned when the match isn't clear, the lookup fails, or no key is set", async () => {
    const i = await createItem(testDb(), owner, tripId, event({ location: "Golden temple" }));
    const before = await version();
    expect(await autoPin(testDb(), tripId, [i.id], async () => unsure)).toBe(0);
    expect(await autoPin(testDb(), tripId, [i.id], async () => ({ candidates: [], suggestedIndex: null }))).toBe(0);
    expect(await autoPin(testDb(), tripId, [i.id], async () => { throw new Error("down"); })).toBe(0);
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const find = vi.fn(async () => clear());
    expect(await autoPin(testDb(), tripId, [i.id], find)).toBe(0);
    expect(find).not.toHaveBeenCalled();
    expect((await getItem(testDb(), owner, tripId, i.id, NOW)).coordinates).toBeNull();
    expect(await version()).toBe(before);
  });

  it("skips flights, events without a place or with a map link, and looks each place name up once", async () => {
    const a = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    const b = await createItem(testDb(), owner, tripId, event({ location: " Kinkaku-ji, Kyoto ", localTime: "15:00" }));
    const linked = await createItem(testDb(), owner, tripId, event({ location: "Ginkaku-ji, Kyoto", mapUrl: "https://www.google.com/maps/@35.02700,135.79800,17z" }));
    const nowhere = await createItem(testDb(), owner, tripId, event({ location: null }));
    const plane = await createItem(testDb(), owner, tripId, flight());
    const find = vi.fn(async () => clear());
    expect(await autoPin(testDb(), tripId, [a.id, b.id, linked.id, nowhere.id, plane.id], find)).toBe(2);
    expect(find).toHaveBeenCalledTimes(1);
    expect((await getItem(testDb(), owner, tripId, linked.id, NOW)).coordinates?.source).toBe("map_link");
  });

  it("leaves an event changed while its lookup ran: renamed, given a link or deleted", async () => {
    const renamed = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    await autoPin(testDb(), tripId, [renamed.id], async () => {
      await updateItem(testDb(), owner, tripId, renamed.id, { item: { ...itemInputOf(renamed), location: "Ryōan-ji, Kyoto" }, expectedVersion: renamed.version }, NOW);
      return clear();
    });
    expect((await getItem(testDb(), owner, tripId, renamed.id, NOW)).coordinates).toBeNull();

    const linked = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    await autoPin(testDb(), tripId, [linked.id], async () => {
      await updateItem(testDb(), owner, tripId, linked.id, { item: { ...itemInputOf(linked), mapUrl: "35.0394, 135.7292" }, expectedVersion: linked.version }, NOW);
      return clear();
    });
    expect((await getItem(testDb(), owner, tripId, linked.id, NOW)).coordinates?.source).toBe("map_link");

    const gone = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    await autoPin(testDb(), tripId, [gone.id], async () => {
      await testDb().updateTable("plan_items").set({ deleted_at: new Date() }).where("id", "=", gone.id).execute();
      return clear();
    });
    const row = await testDb().selectFrom("plan_items").select(["map_url"]).where("id", "=", gone.id).executeTakeFirstOrThrow();
    expect(row.map_url).toBeNull();
  });

  it("spaces automatic lookups out, under the provider's rate", async () => {
    const at: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { at.push(Date.now()); return Response.json({ results: [] }); }));
    const items = await Promise.all(["Kinkaku-ji, Kyoto", "Ryōan-ji, Kyoto", "Tōfuku-ji, Kyoto"].map((location) => createItem(testDb(), owner, tripId, event({ location }))));
    await autoPin(testDb(), tripId, items.map((i) => i.id), findPlaceCandidates);
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThanOrEqual(240);
  });
});

describe("when an automatic pin is looked for", () => {
  it("after a person adds an event with a place and no link, and after they change its place", async () => {
    const c = collector();
    const plain = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }), NOW, c.later);
    await createItem(testDb(), owner, tripId, event({ location: "Ginkaku-ji, Kyoto", mapUrl: "35.02700, 135.79800" }), NOW, c.later);
    await createItem(testDb(), owner, tripId, flight(), NOW, c.later);
    expect(c.tasks).toHaveLength(1);
    // Saving with only the notes changed looks nothing up, so a pin removed on purpose stays removed.
    const notes = await updateItem(testDb(), owner, tripId, plain.id, { item: { ...itemInputOf(plain), notes: "Go early" }, expectedVersion: plain.version }, NOW, c.later);
    expect(c.tasks).toHaveLength(1);
    await updateItem(testDb(), owner, tripId, plain.id, { item: { ...itemInputOf(notes), location: "Ryōan-ji, Kyoto" }, expectedVersion: notes.version }, NOW, c.later);
    expect(c.tasks).toHaveLength(2);
  });

  it("a new place name drops an automatic pin but never a link a person saved; a person's own link replaces an automatic one", async () => {
    const auto = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    await autoPin(testDb(), tripId, [auto.id], async () => clear());
    const pinned = await getItem(testDb(), owner, tripId, auto.id, NOW);
    const moved = await updateItem(testDb(), owner, tripId, auto.id, { item: { ...itemInputOf(pinned), location: "Ryōan-ji, Kyoto" }, expectedVersion: pinned.version }, NOW);
    expect(moved).toMatchObject({ mapUrl: null, coordinates: null });

    const own = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto", mapUrl: "35.03937, 135.72924" }));
    const kept = await updateItem(testDb(), owner, tripId, own.id, { item: { ...itemInputOf(own), location: "Golden Pavilion" }, expectedVersion: own.version }, NOW);
    expect(kept.coordinates).toMatchObject({ source: "map_link" });

    const again = await createItem(testDb(), owner, tripId, event({ location: "Kinkaku-ji, Kyoto" }));
    await autoPin(testDb(), tripId, [again.id], async () => clear());
    const auto2 = await getItem(testDb(), owner, tripId, again.id, NOW);
    const mine = await updateItem(testDb(), owner, tripId, again.id, { item: { ...itemInputOf(auto2), mapUrl: "35.0400, 135.7300" }, expectedVersion: auto2.version }, NOW);
    expect(mine.coordinates).toMatchObject({ latitude: 35.04, longitude: 135.73, source: "map_link" });
  });

  it("after a connected chat adds events, creates a trip or moves an event to a new place", async () => {
    const c = collector();
    const added = await appendAiItems(testDb(), owner, tripId, [
      { type: "activity", title: "Golden Pavilion", bookingStatus: "Not required", localDate: "2026-11-17", location: "Kinkaku-ji, Kyoto" },
      { type: "activity", title: "Free afternoon", bookingStatus: "Not required", localDate: "2026-11-17" },
    ], NOW, c.later);
    expect(c.tasks).toHaveLength(1);
    const find = vi.fn(async () => clear());
    // The scheduled task uses the real lookup; check the same ids get pinned by running it against a stub.
    await autoPin(testDb(), tripId, added.map((i) => i.id), find);
    expect(find).toHaveBeenCalledTimes(1);
    expect((await getItem(testDb(), owner, tripId, added[0]!.id, NOW)).coordinates?.source).toBe("lookup");

    const moved = await updateItemByAi(testDb(), owner, tripId, added[0]!.id, { location: "Ryōan-ji, Kyoto" }, NOW, c.later);
    expect(moved).toMatchObject({ clearedPin: true, item: { mapUrl: null } });
    expect(c.tasks).toHaveLength(2);
    await updateItemByAi(testDb(), owner, tripId, added[0]!.id, { notes: "Quiet garden" }, NOW, c.later);
    expect(c.tasks).toHaveLength(2);

    await createTripByAi(testDb(), owner, { trip: { title: "Osaka", destination: "Osaka, Japan", startDate: "2026-12-01", endDate: "2026-12-03", timeZone: "Asia/Tokyo" }, items: [{ type: "meal", title: "Okonomiyaki", bookingStatus: "Not required", localDate: "2026-12-01", location: "Mizuno, Dōtonbori, Osaka" }] }, NOW, c.later);
    expect(c.tasks).toHaveLength(3);
  });

  it("the database refuses an automatic pin without a map link", async () => {
    const i = await createItem(testDb(), owner, tripId, event());
    await expect(testDb().updateTable("plan_items").set({ pin_source: "lookup" }).where("id", "=", i.id).execute()).rejects.toMatchObject({ code: "23514" });
  });
});
