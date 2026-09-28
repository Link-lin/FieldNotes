import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import { createItem, updateItemNotes } from "@/server/modules/items/items.service";
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

const notes = await import("@/app/api/trips/[tripId]/items/[itemId]/notes/route");

const ORIGIN = "http://localhost:3000";
const patch = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/x`, { method: "PATCH", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const ctx = (tripId: string, itemId: string) => ({ params: Promise.resolve({ tripId, itemId }) });

let owner: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  session.actor = null;
});

describe("event notes (TRIP-10)", () => {
  it("saves only the notes, trimmed, and bumps the event and trip versions", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event({ notes: "Old" }));
    const before = (await getTripDetail(testDb(), owner, t.id, NOW)).trip.version;
    const saved = await updateItemNotes(testDb(), owner, t.id, i.id, { notes: "  Bring cash for the omamori.  ", expectedVersion: i.version }, NOW);
    expect(saved).toMatchObject({ notes: "Bring cash for the omamori.", version: i.version + 1, title: i.title, localTime: i.localTime, location: i.location });
    expect((await getTripDetail(testDb(), owner, t.id, NOW)).trip.version).toBe(before + 1);
    const cleared = await updateItemNotes(testDb(), owner, t.id, i.id, { notes: "   ", expectedVersion: saved.version }, NOW);
    expect(cleared.notes).toBeNull();
  });

  it("returns 409 on a stale version, 403 to viewers and 404 to strangers, over the route", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    await grant(t.id, viewer);

    session.actor = owner;
    const ok = await notes.PATCH(patch({ notes: "Meet at the gate", expectedVersion: i.version }), ctx(t.id, i.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(((await ok.json()) as { notes: string }).notes).toBe("Meet at the gate");
    expect((await notes.PATCH(patch({ notes: "Again", expectedVersion: i.version }), ctx(t.id, i.id))).status).toBe(409);
    expect((await notes.PATCH(patch({ notes: "x".repeat(5001), expectedVersion: i.version + 1 }), ctx(t.id, i.id))).status).toBe(422);
    expect((await notes.PATCH(patch({ notes: "Hi", expectedVersion: i.version + 1 }, "https://evil.example"), ctx(t.id, i.id))).status).toBe(403);

    session.actor = viewer;
    expect((await notes.PATCH(patch({ notes: "Viewer edit", expectedVersion: i.version + 1 }), ctx(t.id, i.id))).status).toBe(403);
    session.actor = stranger;
    expect((await notes.PATCH(patch({ notes: "Stranger edit", expectedVersion: i.version + 1 }), ctx(t.id, i.id))).status).toBe(404);
    session.actor = null;
    expect((await notes.PATCH(patch({ notes: "Anon", expectedVersion: i.version + 1 }), ctx(t.id, i.id))).status).toBe(401);

    expect((await getTripDetail(testDb(), owner, t.id, NOW)).items[0]!.notes).toBe("Meet at the gate");
  });
});
