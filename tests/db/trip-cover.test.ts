import { readFileSync } from "node:fs";
import { sql } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { createTrip, deleteTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import type { Actor } from "@/server/auth/actor";
import type { TripSummaryDTO } from "@/shared/dto";

// The cover's route handlers run end to end with only the session lookup replaced.
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

const cover = await import("@/app/api/trips/[tripId]/cover/route");

const ORIGIN = "http://localhost:3000";
// The test trips' covers: real JPEGs, already without metadata.
const image = (name: string) => readFileSync(new URL(`../../scripts/demo-covers/${name}.jpg`, import.meta.url));
const HAWAII = { full: image("hawaii-full"), small: image("hawaii-small") };
const KYOTO = { full: image("kyoto-full"), small: image("kyoto-small") };

/** The same JPEG with an EXIF segment (a made-up location) after its start marker. */
function withExif(jpeg: Buffer): Buffer {
  const body = Buffer.from("Exif\0\0GPS 37.7749 N 122.4194 W");
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body, jpeg.subarray(2)]);
}

/** The same JPEG with the size in its frame header changed (the walk never decodes the picture). */
function withSize(jpeg: Buffer, width: number, height: number): Buffer {
  const out = Buffer.from(jpeg);
  const at = out.indexOf(Buffer.from([0xff, 0xc0]));
  out.writeUInt16BE(height, at + 5);
  out.writeUInt16BE(width, at + 7);
  return out;
}

/** A cover upload as the browser sends it; the form is encoded up front, as it would arrive over the network. */
async function put(parts: { full?: Buffer; small?: Buffer; base?: string }, origin: string | null = ORIGIN): Promise<Request> {
  const form = new FormData();
  if (parts.full) form.append("full", new Blob([new Uint8Array(parts.full)]), "full.jpg");
  if (parts.small) form.append("small", new Blob([new Uint8Array(parts.small)]), "small.jpg");
  if (parts.base !== undefined) form.append("base", parts.base);
  const encoded = new Response(form);
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")! };
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}/api/trips/x/cover`, { method: "PUT", headers, body: await encoded.arrayBuffer() });
}
const del = (base: string) => new Request(`${ORIGIN}/api/trips/x/cover`, { method: "DELETE", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ base }) });
const get = (size?: string) => new Request(`${ORIGIN}/api/trips/x/cover${size ? `?size=${size}` : ""}`);
const ctx = (tripId: string) => ({ params: Promise.resolve({ tripId }) });
const version = async (tripId: string, who: Actor) => (await getTripDetail(testDb(), who, tripId, NOW)).trip.version;
const coverRows = async () => Number((await sql<{ n: string }>`select count(*) as n from trip_covers`.execute(testDb())).rows[0]!.n);

let owner: Actor, coOwner: Actor, editor: Actor, viewer: Actor, stranger: Actor, tripId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  coOwner = await makeActor("co@example.com", "Ana");
  editor = await makeActor("editor@example.com", "Ed");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  tripId = (await createTrip(testDb(), owner, tripInput, NOW)).id;
  await grant(tripId, coOwner, "accepted", "owner");
  await grant(tripId, editor, "accepted", "editor");
  await grant(tripId, viewer, "accepted", "viewer");
  session.actor = owner;
});

describe("trip cover (DASH-8)", () => {
  it("lets an owner add, replace and remove it, moving the trip's version once each", async () => {
    expect((await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover).toBeNull();
    const v1 = await version(tripId, owner);

    const added = await cover.PUT(await put({ ...HAWAII, base: "" }), ctx(tripId));
    expect(added.status).toBe(200);
    expect(added.headers.get("cache-control")).toContain("no-store");
    const a = ((await added.json()) as TripSummaryDTO).cover!;
    expect(a).toMatchObject({ width: 1067, height: 1600 });
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(a.small).toBe(`/api/trips/${tripId}/cover?size=small&v=${a.version}`);
    expect(a.full).toBe(`/api/trips/${tripId}/cover?size=full&v=${a.version}`);
    expect(await version(tripId, owner)).toBe(v1 + 1);
    expect((await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover).toEqual(a);

    const small = await cover.GET(get("small"), ctx(tripId));
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/jpeg");
    expect(small.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await small.arrayBuffer())).toEqual(HAWAII.small);
    expect(Buffer.from(await (await cover.GET(get("full"), ctx(tripId))).arrayBuffer())).toEqual(HAWAII.full);
    // Anything but `full` is the small image.
    expect(Buffer.from(await (await cover.GET(get(), ctx(tripId))).arrayBuffer())).toEqual(HAWAII.small);

    const replaced = await cover.PUT(await put({ ...KYOTO, base: a.version }), ctx(tripId));
    expect(replaced.status).toBe(200);
    const b = ((await replaced.json()) as TripSummaryDTO).cover!;
    expect(b.version).not.toBe(a.version);
    expect(await version(tripId, owner)).toBe(v1 + 2);
    expect(Buffer.from(await (await cover.GET(get("full"), ctx(tripId))).arrayBuffer())).toEqual(KYOTO.full);

    const removed = await cover.DELETE(del(b.version), ctx(tripId));
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as TripSummaryDTO).cover).toBeNull();
    expect(await version(tripId, owner)).toBe(v1 + 3);
    expect((await cover.GET(get("small"), ctx(tripId))).status).toBe(404);
    expect(await coverRows()).toBe(0);

    // Removing a cover that isn't there changes nothing.
    expect((await cover.DELETE(del(""), ctx(tripId))).status).toBe(200);
    expect(await version(tripId, owner)).toBe(v1 + 3);
  });

  it("refuses a change based on a cover that has changed since, keeping the newer one", async () => {
    const first = ((await (await cover.PUT(await put({ ...HAWAII, base: "" }), ctx(tripId))).json()) as TripSummaryDTO).cover!;
    const v = await version(tripId, owner);

    const stale = await cover.PUT(await put({ ...KYOTO, base: "" }), ctx(tripId));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "field_conflict", fields: [{ path: "cover" }] } });
    expect((await cover.DELETE(del("0123456789abcdef"), ctx(tripId))).status).toBe(409);
    expect((await cover.DELETE(del(""), ctx(tripId))).status).toBe(409);
    expect((await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover).toEqual(first);
    expect(await version(tripId, owner)).toBe(v);
  });

  it("stores the images without their metadata", async () => {
    expect((await cover.PUT(await put({ full: withExif(HAWAII.full), small: withExif(HAWAII.small), base: "" }), ctx(tripId))).status).toBe(200);
    for (const size of ["full", "small"]) {
      const bytes = Buffer.from(await (await cover.GET(get(size), ctx(tripId))).arrayBuffer());
      expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
      expect(bytes.includes(Buffer.from("GPS"))).toBe(false);
      expect(bytes).toEqual(size === "full" ? HAWAII.full : HAWAII.small);
    }
  });

  it("lets every role see it, only owners change it, and strangers learn nothing", async () => {
    session.actor = coOwner;
    expect((await cover.PUT(await put({ ...HAWAII, base: "" }), ctx(tripId))).status).toBe(200);
    const base = (await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover!.version;

    for (const who of [editor, viewer]) {
      session.actor = who;
      expect((await cover.GET(get("full"), ctx(tripId))).status).toBe(200);
      expect((await cover.PUT(await put({ ...KYOTO, base }), ctx(tripId))).status).toBe(403);
      expect((await cover.DELETE(del(base), ctx(tripId))).status).toBe(403);
    }
    session.actor = stranger;
    const hidden = await cover.GET(get("small"), ctx(tripId));
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("content-type")).toContain("application/json");
    expect((await cover.PUT(await put({ ...KYOTO, base }), ctx(tripId))).status).toBe(404);
    expect((await cover.DELETE(del(base), ctx(tripId))).status).toBe(404);
    session.actor = null;
    expect((await cover.GET(get("small"), ctx(tripId))).status).toBe(401);

    session.actor = owner;
    expect((await cover.PUT(await put({ ...KYOTO, base }, "https://evil.example"), ctx(tripId))).status).toBe(403);
    expect((await cover.PUT(await put({ ...KYOTO, base }, null), ctx(tripId))).status).toBe(403);
    expect((await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover!.version).toBe(base);
  });

  it("refuses what isn't a cover, writing nothing", async () => {
    const v = await version(tripId, owner);
    const json = new Request(`${ORIGIN}/api/trips/x/cover`, { method: "PUT", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ full: "x" }) });
    expect((await cover.PUT(json, ctx(tripId))).status).toBe(400);
    expect((await cover.PUT(await put({ full: HAWAII.full, base: "" }), ctx(tripId))).status).toBe(400);
    expect((await cover.PUT(await put({ ...HAWAII }), ctx(tripId))).status).toBe(400);

    const refused = async (parts: { full: Buffer; small: Buffer }, path: string, code: string) => {
      const r = await cover.PUT(await put({ ...parts, base: "" }), ctx(tripId));
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: { code: "validation_error", fields: [{ path, code }] } });
    };
    await refused({ full: Buffer.from("\x89PNG\r\n\x1a\n not a jpeg"), small: HAWAII.small }, "full", "invalid_image");
    await refused({ full: HAWAII.full, small: HAWAII.full }, "small", "image_size");
    await refused({ full: withSize(HAWAII.full, 4000, 3000), small: HAWAII.small }, "full", "image_size");
    await refused({ full: withSize(HAWAII.full, 1800, 500), small: withSize(HAWAII.small, 480, 133) }, "full", "image_shape");
    await refused({ full: HAWAII.full, small: withSize(HAWAII.small, 480, 320) }, "small", "image_shape");
    await refused({ full: HAWAII.small, small: HAWAII.small.subarray(0, 300) }, "small", "invalid_image");

    const big = await cover.PUT(await put({ full: Buffer.alloc(1024 * 1024 + 1, 0xff), small: HAWAII.small, base: "" }), ctx(tripId));
    expect(big.status).toBe(413);

    expect((await getTripDetail(testDb(), owner, tripId, NOW)).trip.cover).toBeNull();
    expect(await version(tripId, owner)).toBe(v);
    expect(await coverRows()).toBe(0);
  });

  it("is on the dashboard's cards, and goes with the trip", async () => {
    await cover.PUT(await put({ ...HAWAII, base: "" }), ctx(tripId));
    const card = (await getDashboard(testDb(), viewer, NOW)).trips.find((t) => t.id === tripId)!;
    expect(card.cover).toMatchObject({ width: 1067, height: 1600 });

    await deleteTrip(testDb(), owner, tripId, await version(tripId, owner));
    expect(await coverRows()).toBe(0);
  });

  it("keeps the trip's cover columns whole and the images within their limits", async () => {
    const db = testDb();
    await expect(sql`update trips set cover_hash = ${"a".repeat(64)} where id = ${tripId}`.execute(db)).rejects.toThrow(/trips_cover/);
    await expect(sql`update trips set cover_hash = 'not-a-hash', cover_width = 10, cover_height = 10 where id = ${tripId}`.execute(db)).rejects.toThrow(/trips_cover/);
    await expect(sql`update trips set cover_hash = ${"a".repeat(64)}, cover_width = 4096, cover_height = 10 where id = ${tripId}`.execute(db)).rejects.toThrow(/trips_cover/);
    await expect(sql`insert into trip_covers (trip_id, full_jpeg, small_jpeg) values (${tripId}, ${Buffer.alloc(0)}, ${Buffer.alloc(8)})`.execute(db)).rejects.toThrow(/trip_covers_full_jpeg_check/);
  });
});
