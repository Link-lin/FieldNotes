import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { createItem, updateItemByAi } from "@/server/modules/items/items.service";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import { tripRevision } from "@/shared/revision";

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

const tripRoute = await import("@/app/api/trips/[tripId]/revision/route");
const dashboardRoute = await import("@/app/api/dashboard/revision/route");

const get = () => new Request("http://localhost:3000/api/x");
const ctx = (tripId: string) => ({ params: Promise.resolve({ tripId }) });

async function tripRev(as: Actor | null, tripId: string): Promise<{ status: number; revision?: string; cache: string | null }> {
  session.actor = as;
  const res = await tripRoute.GET(get(), ctx(tripId));
  const body = res.status === 200 ? ((await res.json()) as { revision: string }) : null;
  return { status: res.status, revision: body?.revision, cache: res.headers.get("cache-control") };
}
async function dashRev(as: Actor): Promise<string> {
  session.actor = as;
  const res = await dashboardRoute.GET(get());
  expect(res.status).toBe(200);
  return ((await res.json()) as { revision: string }).revision;
}

let owner: Actor, editor: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  editor = await makeActor("editor@example.com", "Ed");
  viewer = await makeActor("viewer@example.com", "Vi");
  stranger = await makeActor("stranger@example.com", "Eve");
  session.actor = null;
});

describe("trip revision (TRIP-11)", () => {
  it("matches what the trip page was rendered with, for every role, and is never cached", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    await grant(t.id, editor, "accepted", "editor");
    await grant(t.id, viewer);
    for (const who of [owner, editor, viewer]) {
      const page = await getTripDetail(testDb(), who, t.id, NOW);
      const r = await tripRev(who, t.id);
      expect(r).toMatchObject({ status: 200, revision: tripRevision(page.trip) });
      expect(r.cache).toContain("no-store");
    }
    expect((await tripRev(owner, t.id)).revision).not.toBe((await tripRev(viewer, t.id)).revision);
  });

  it("moves when an event is added or a connected chat changes one, and when your role changes", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    await grant(t.id, editor, "accepted", "editor");
    const first = (await tripRev(editor, t.id)).revision;
    const i = await createItem(testDb(), owner, t.id, event());
    const second = (await tripRev(editor, t.id)).revision;
    expect(second).not.toBe(first);
    await updateItemByAi(testDb(), owner, t.id, i.id, { localTime: "15:00" }, NOW);
    const third = (await tripRev(editor, t.id)).revision;
    expect(third).not.toBe(second);
    expect((await tripRev(editor, t.id)).revision).toBe(third);
    await testDb().updateTable("trip_viewers").set({ role: "viewer" }).where("viewer_user_id", "=", editor.userId).execute();
    expect((await tripRev(editor, t.id)).revision).not.toBe(third);
  });

  it("says nothing about a trip to a stranger, someone whose access ended or a signed-out request", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    await grant(t.id, viewer);
    expect((await tripRev(stranger, t.id)).status).toBe(404);
    expect((await tripRev(owner, "not-a-uuid")).status).toBe(404);
    expect((await tripRev(null, t.id)).status).toBe(401);
    await testDb().updateTable("trip_viewers").set({ status: "revoked", invitation_token_hash: null, revoked_at: new Date() }).where("viewer_user_id", "=", viewer.userId).execute();
    expect((await tripRev(viewer, t.id)).status).toBe(404);
  });
});

describe("dashboard revision (TRIP-11)", () => {
  it("matches what the dashboard was rendered with, and stays put while nothing changes", async () => {
    await createTrip(testDb(), owner, tripInput, NOW);
    const rendered = (await getDashboard(testDb(), owner, NOW)).revision;
    expect(await dashRev(owner)).toBe(rendered);
    expect(await dashRev(owner)).toBe(rendered);
  });

  it("moves when a trip is created, one of its events changes, or a trip is shared with you or stops being shared", async () => {
    const a = await dashRev(viewer);
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    expect(await dashRev(viewer)).toBe(a); // not yours to see
    const o1 = await dashRev(owner);
    await createItem(testDb(), owner, t.id, event());
    const o2 = await dashRev(owner);
    expect(o2).not.toBe(o1);
    await grant(t.id, viewer);
    const b = await dashRev(viewer);
    expect(b).not.toBe(a);
    await testDb().updateTable("trip_viewers").set({ role: "editor" }).where("viewer_user_id", "=", viewer.userId).execute();
    const c = await dashRev(viewer);
    expect(c).not.toBe(b);
    await testDb().updateTable("trip_viewers").set({ status: "revoked", invitation_token_hash: null, revoked_at: new Date() }).where("viewer_user_id", "=", viewer.userId).execute();
    expect(await dashRev(viewer)).toBe(a);
  });
});
