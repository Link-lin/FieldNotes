import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { appendAiItems } from "@/server/modules/import/import.service";
import { createItem, duplicateItem, getItem, reviewItems, updateItem, updateItemByAi } from "@/server/modules/items/items.service";
import { itemView } from "@/server/modules/connector/mcp.format";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import { itemInputOf } from "@/server/modules/items/items.ai";
import type { PlanItemDTO } from "@/shared/dto";

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
const reviewRoute = await import("@/app/api/trips/[tripId]/items/review/route");

const ORIGIN = "http://localhost:3000";
const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/x`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const ctx = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const ask = (list: PlanItemDTO[], reviewed = true) => ({ items: list.map((i) => ({ id: i.id, expectedVersion: i.version })), reviewed });

const temple = { type: "activity", title: "Golden Pavilion", bookingStatus: "Not required", localDate: "2026-11-17", localTime: "10:00", location: "Kinkaku-ji, Kyoto" };
const garden = { type: "activity", title: "Moss garden", bookingStatus: "Not required", localDate: "2026-11-17", location: "Saihō-ji, Kyoto" };
const hop = { type: "flight", title: "Haneda to Itami", bookingStatus: "Needs booking", flightDetails: { plannedDepartureDate: "2026-11-18", departure: { airportCode: "HND" }, arrival: { airportCode: "ITM" } } };

let owner: Actor, editor: Actor, viewer: Actor, stranger: Actor;
let tripId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  editor = await makeActor("editor@example.com", "Ed");
  viewer = await makeActor("viewer@example.com", "Vi");
  stranger = await makeActor("stranger@example.com", "Eve");
  tripId = (await createTrip(testDb(), owner, tripInput, NOW)).id;
  await grant(tripId, editor, "accepted", "editor");
  await grant(tripId, viewer);
  session.actor = null;
});

const tripVersion = async () => (await getTripDetail(testDb(), owner, tripId, NOW)).trip.version;

describe("marking AI drafts reviewed (IMPORT-7)", () => {
  it("marks one event or many at once, keeps where they came from, and bumps the trip once", async () => {
    const [a, b] = await appendAiItems(testDb(), owner, tripId, [temple, garden], NOW);
    const before = await tripVersion();
    const saved = await reviewItems(testDb(), editor, tripId, ask([a!, b!]), NOW);
    expect(saved.map((i) => [i.id, i.source, i.version])).toEqual([[a!.id, "ai", a!.version + 1], [b!.id, "ai", b!.version + 1]]);
    expect(saved.every((i) => i.reviewedAt === NOW.toISOString())).toBe(true);
    expect(await tripVersion()).toBe(before + 1);
    // Asking again for what is already so changes nothing.
    const again = await reviewItems(testDb(), owner, tripId, ask(saved), NOW);
    expect(again.map((i) => i.version)).toEqual(saved.map((i) => i.version));
    expect(await tripVersion()).toBe(before + 1);
    // Undo makes them drafts again.
    const undone = await reviewItems(testDb(), owner, tripId, ask(saved, false), NOW);
    expect(undone.every((i) => i.reviewedAt === null && i.source === "ai")).toBe(true);
  });

  it("is all or nothing: a stale version, an event that isn't an AI draft or a missing one changes nothing", async () => {
    const [a, b] = await appendAiItems(testDb(), owner, tripId, [temple, garden], NOW);
    const mine = await createItem(testDb(), owner, tripId, event());
    const reviewedNone = async () => (await getTripDetail(testDb(), owner, tripId, NOW)).items.every((i) => i.reviewedAt === null);
    await expect(reviewItems(testDb(), owner, tripId, { items: [{ id: a!.id, expectedVersion: a!.version }, { id: b!.id, expectedVersion: b!.version + 1 }], reviewed: true }, NOW)).rejects.toMatchObject({ status: 409 });
    expect(await reviewedNone()).toBe(true);
    await expect(reviewItems(testDb(), owner, tripId, ask([a!, mine]), NOW)).rejects.toMatchObject({ status: 422, fields: [{ path: "items[1].id", code: "not_ai_draft" }] });
    expect(await reviewedNone()).toBe(true);
    await expect(reviewItems(testDb(), owner, tripId, { items: [{ id: a!.id, expectedVersion: a!.version }, { id: crypto.randomUUID(), expectedVersion: 1 }], reviewed: true }, NOW)).rejects.toMatchObject({ status: 404 });
    // Another trip's event is not found here either.
    const other = (await createTrip(testDb(), owner, { ...tripInput, title: "Other" }, NOW)).id;
    const [elsewhere] = await appendAiItems(testDb(), owner, other, [temple], NOW);
    await expect(reviewItems(testDb(), owner, tripId, ask([elsewhere!]), NOW)).rejects.toMatchObject({ status: 404 });
    expect(await reviewedNone()).toBe(true);
  });

  it("over the route: owners and editors only, same origin, a valid list, never cached", async () => {
    const [a] = await appendAiItems(testDb(), owner, tripId, [temple], NOW);
    session.actor = viewer;
    expect((await reviewRoute.POST(post(ask([a!])), ctx(tripId))).status).toBe(403);
    session.actor = stranger;
    expect((await reviewRoute.POST(post(ask([a!])), ctx(tripId))).status).toBe(404);
    session.actor = null;
    expect((await reviewRoute.POST(post(ask([a!])), ctx(tripId))).status).toBe(401);
    session.actor = editor;
    expect((await reviewRoute.POST(post(ask([a!]), "https://evil.example"), ctx(tripId))).status).toBe(403);
    expect((await reviewRoute.POST(post({ items: [], reviewed: true }), ctx(tripId))).status).toBe(422);
    expect((await reviewRoute.POST(post({ items: [{ id: a!.id, expectedVersion: 1 }, { id: a!.id, expectedVersion: 1 }], reviewed: true }), ctx(tripId))).status).toBe(422);
    expect((await reviewRoute.POST(post({ ...ask([a!]), extra: 1 }), ctx(tripId))).status).toBe(422);
    const ok = await reviewRoute.POST(post(ask([a!])), ctx(tripId));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(((await ok.json()) as PlanItemDTO[])[0]).toMatchObject({ id: a!.id, source: "ai", reviewedAt: expect.any(String) });
  });

  it("pins a reviewed AI flight at its arrival airport, as for a flight a person entered", async () => {
    const [f] = await appendAiItems(testDb(), owner, tripId, [hop], NOW);
    expect(f!.coordinates).toBeNull();
    const [reviewed] = await reviewItems(testDb(), owner, tripId, ask([f!]), NOW);
    expect(reviewed!.coordinates).toMatchObject({ source: "airport" });
  });

  it("a connected chat's change makes a reviewed draft a draft again; a change that changes nothing does not", async () => {
    const [a] = await appendAiItems(testDb(), owner, tripId, [temple], NOW);
    const [reviewed] = await reviewItems(testDb(), owner, tripId, ask([a!]), NOW);
    const same = await updateItemByAi(testDb(), owner, tripId, a!.id, { title: "Golden Pavilion" }, NOW);
    expect(same.item.reviewedAt).not.toBeNull();
    const moved = await updateItemByAi(testDb(), owner, tripId, a!.id, { localTime: "14:00" }, NOW);
    expect(moved.item).toMatchObject({ source: "ai", reviewedAt: null, localTime: "14:00" });
    expect(reviewed!.reviewedAt).not.toBeNull();
    // The chat's change to an event a person made never makes it an AI draft.
    const mine = await createItem(testDb(), owner, tripId, event());
    expect((await updateItemByAi(testDb(), owner, tripId, mine.id, { localTime: "08:00" }, NOW)).item).toMatchObject({ source: "manual", reviewedAt: null });
  });

  it("a person's own edit keeps the review, a copy keeps it, and the chat sees it", async () => {
    const [a] = await appendAiItems(testDb(), owner, tripId, [temple], NOW);
    const [reviewed] = await reviewItems(testDb(), owner, tripId, ask([a!]), NOW);
    const edited = await updateItem(testDb(), editor, tripId, a!.id, { item: { ...itemInputOf(reviewed!), title: "Kinkaku-ji" }, expectedVersion: reviewed!.version }, NOW);
    expect(edited).toMatchObject({ title: "Kinkaku-ji", source: "ai", reviewedAt: reviewed!.reviewedAt });
    const copy = await duplicateItem(testDb(), owner, tripId, a!.id, edited.version, NOW);
    expect(copy).toMatchObject({ source: "ai", reviewedAt: reviewed!.reviewedAt });
    expect(itemView(await getItem(testDb(), owner, tripId, a!.id, NOW))).toMatchObject({ addedBy: "ai", reviewedByPerson: true });
    const [draft] = await appendAiItems(testDb(), owner, tripId, [garden], NOW);
    expect(itemView(draft!)).not.toHaveProperty("reviewedByPerson");
  });

  it("the database refuses a review, or a first change to an AI item, on an event a person made", async () => {
    const mine = await createItem(testDb(), owner, tripId, event());
    await expect(testDb().updateTable("plan_items").set({ reviewed_at: new Date() }).where("id", "=", mine.id).execute()).rejects.toMatchObject({ code: "23514" });
    await expect(testDb().updateTable("plan_items").set({ person_edited_at: new Date() }).where("id", "=", mine.id).execute()).rejects.toMatchObject({ code: "23514" });
  });
});
