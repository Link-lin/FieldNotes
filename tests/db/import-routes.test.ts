import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import { makeActor, reset, testDb } from "./helpers";
import example from "../../docs/design/import-example-v1.json";

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

const preview = await import("@/app/api/import/preview/route");
const commit = await import("@/app/api/import/commit/route");
const schema = await import("@/app/api/import/schema/route");
const origin = "http://localhost:3000";
const request = (path: string, body: unknown, originHeader: string | null = origin, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(originHeader ? { Origin: originHeader } : {}), ...headers },
    body: JSON.stringify(body),
  });
const budget = { amount: "1200.00", currency: "USD" };
const previewBody = { responseText: JSON.stringify(example), ownerProvidedBudget: budget };

beforeEach(async () => {
  await reset();
  session.actor = null;
});

describe("AI import routes", () => {
  it("requires an owner session and same origin before parsing private content", async () => {
    expect((await preview.POST(request("/api/import/preview", previewBody))).status).toBe(401);
    session.actor = await makeActor("viewer@example.com");
    expect((await preview.POST(request("/api/import/preview", previewBody))).status).toBe(403);
    session.actor = await makeActor("owner@example.com");
    expect((await preview.POST(request("/api/import/preview", previewBody, null))).status).toBe(403);
    expect((await commit.POST(request("/api/import/commit", {}, "https://evil.example"))).status).toBe(403);
  });

  it("previews the published fixture without writing, and serves the exact schema", async () => {
    session.actor = await makeActor("owner@example.com");
    const response = await preview.POST(request("/api/import/preview", previewBody));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const data = await response.json();
    expect(data.items).toHaveLength(example.items.length);
    expect(data.trip.values.budget).toEqual(budget);
    expect(await testDb().selectFrom("trips").select("id").execute()).toHaveLength(0);
    const schemaResponse = await schema.GET(new Request(`${origin}/api/import/schema`));
    expect(schemaResponse.status).toBe(200);
    expect((await schemaResponse.json()).properties.formatVersion.const).toBe(1);
  });

  it("returns repairable 422 errors for malformed pasted content and 400 for a bad commit key", async () => {
    session.actor = await makeActor("owner@example.com");
    const bad = await preview.POST(request("/api/import/preview", { ...previewBody, responseText: "{invalid" }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fields.length).toBeGreaterThan(0);
    const badKey = await commit.POST(request("/api/import/commit", {
      expectedFormatVersion: 1,
      ownerProvidedBudget: null,
      trip: { title: "Empty", destination: "Tokyo, Japan", startDate: "2027-01-01", endDate: "2027-01-02", timeZone: "Asia/Tokyo", budget: null },
      items: [],
    }, origin, { "Idempotency-Key": "not-a-uuid" }));
    expect(badKey.status).toBe(400);
  });
});
