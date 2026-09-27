import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, tripInput } from "./helpers";
import { testDb } from "./helpers";
import { createTrip, getTripDetail } from "@/server/trips";
import { createItem } from "@/server/items";
import { allowSignIn } from "@/server/auth/sign-in-gate";
import type { Actor } from "@/server/auth/actor";

// Route handlers are exercised end to end with only the session lookup replaced.
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

const trips = await import("@/app/api/trips/route");
const trip = await import("@/app/api/trips/[tripId]/route");
const items = await import("@/app/api/trips/[tripId]/items/route");
const item = await import("@/app/api/trips/[tripId]/items/[itemId]/route");

const ORIGIN = "http://localhost:3000";
const req = (method: string, body?: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/x`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

let owner: Actor, viewer: Actor, stranger: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  session.actor = null;
});

describe("route handlers", () => {
  it("returns 401 without a session, with no-store", async () => {
    const r = await trips.GET();
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect((await trips.POST(req("POST", tripInput))).status).toBe(401);
  });

  it("rejects a mutation from another origin or with no Origin header", async () => {
    session.actor = owner;
    expect((await trips.POST(req("POST", tripInput, "https://evil.example"))).status).toBe(403);
    expect((await trips.POST(req("POST", tripInput, null))).status).toBe(403);
    const ok = await trips.POST(req("POST", tripInput));
    expect(ok.status).toBe(201);
    expect(ok.headers.get("cache-control")).toContain("no-store");
  });

  it("gives viewers 403 on writes and strangers 404", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    const i = await createItem(testDb(), owner, t.id, event());
    await grant(t.id, viewer);
    const v = (await getTripDetail(testDb(), owner, t.id, NOW)).trip.version;

    session.actor = viewer;
    expect((await trip.GET(req("GET", undefined), ctx({ tripId: t.id }))).status).toBe(200);
    expect((await items.POST(req("POST", event()), ctx({ tripId: t.id }))).status).toBe(403);
    expect((await item.DELETE(req("DELETE", { expectedVersion: i.version }), ctx({ tripId: t.id, itemId: i.id }))).status).toBe(403);
    expect((await trip.DELETE(req("DELETE", { confirm: true, expectedVersion: v }), ctx({ tripId: t.id }))).status).toBe(403);

    session.actor = stranger;
    const g = await trip.GET(req("GET", undefined), ctx({ tripId: t.id }));
    expect(g.status).toBe(404);
    expect(await g.text()).not.toContain(t.title);
    expect((await items.POST(req("POST", event()), ctx({ tripId: t.id }))).status).toBe(404);
    expect((await trip.GET(req("GET", undefined), ctx({ tripId: "not-a-uuid" }))).status).toBe(404);
  });

  it("rejects bodies over 1 MiB", async () => {
    session.actor = owner;
    const r = await trips.POST(req("POST", { ...tripInput, title: "x".repeat(1_100_000) }));
    expect(r.status).toBe(413);
  });
});

describe("sign-in gate (ACCESS-1)", () => {
  const attempt = (email: string, over: Partial<Parameters<typeof allowSignIn>[1]> = {}) => ({
    provider: "google",
    providerAccountId: `sub-${email}`,
    email,
    emailVerified: true,
    ...over,
  });

  it("admits allowlisted verified owners, case-insensitively", async () => {
    expect(await allowSignIn(testDb(), attempt(" Owner@Example.com "))).toBe(true);
    expect(await allowSignIn(testDb(), attempt("owner@example.com", { emailVerified: false }))).toBe(false);
    expect(await allowSignIn(testDb(), attempt("owner@example.com", { provider: "github" }))).toBe(false);
  });

  it("admits a pending, unexpired invitation only", async () => {
    const t = await createTrip(testDb(), owner, tripInput, NOW);
    expect(await allowSignIn(testDb(), attempt("viewer@example.com"))).toBe(false);
    await grant(t.id, viewer, "pending");
    expect(await allowSignIn(testDb(), attempt("viewer@example.com"))).toBe(true);
    expect(await allowSignIn(testDb(), attempt("viewer@example.com"), new Date(Date.now() + 8 * 864e5))).toBe(false);
  });

  it("lets an already-linked Google subject back in without an allowlist entry", async () => {
    await testDb()
      .insertInto("Account")
      .values({ userId: stranger.userId, type: "oidc", provider: "google", providerAccountId: "sub-linked" } as never)
      .execute();
    expect(await allowSignIn(testDb(), attempt("stranger@example.com", { providerAccountId: "sub-linked", emailVerified: false }))).toBe(true);
    expect(await allowSignIn(testDb(), attempt("stranger@example.com"))).toBe(false);
  });
});
