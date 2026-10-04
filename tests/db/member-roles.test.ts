import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { type Actor } from "@/server/auth/actor";
import { HttpError } from "@/server/core/http/errors";
import { deleteAccount } from "@/server/modules/account/account.service";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { acceptInvitation, createInvitation, listInvitations, revokeInvitation, updateInvitationRole } from "@/server/modules/invitations/invitations.service";
import { createItem, deleteItem, duplicateItem, restoreItem, updateItem, updateItemBooking, updateItemNotes } from "@/server/modules/items/items.service";
import { previewTimeZone } from "@/server/modules/trips/time-zone.service";
import { createTrip, deleteTrip, getTripDetail, updateTrip } from "@/server/modules/trips/trips.service";
import { createHash } from "node:crypto";

// Routes run end to end with only the session lookup replaced.
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
const places = await import("@/app/api/atlas/places/route");
const resolve = await import("@/app/api/places/resolve/route");
const importPreview = await import("@/app/api/import/preview/route");
const memberRoute = await import("@/app/api/trips/[tripId]/invitations/[invitationId]/route");
const membersRoute = await import("@/app/api/trips/[tripId]/invitations/route");

const ORIGIN = "http://localhost:3000";
const req = (method: string, body?: unknown, url = `${ORIGIN}/api/x`) =>
  new Request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const db = () => testDb();
const sha = (token: string) => createHash("sha256").update(token).digest();

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected HTTP ${status}`).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

// owner: the creator, on the allowlist. coOwner/editor/viewer: accepted grants of that role, not on the allowlist.
let owner: Actor, coOwner: Actor, editor: Actor, viewer: Actor, stranger: Actor, tripId: string, itemId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  coOwner = await makeActor("coowner@example.com", "Jordan");
  editor = await makeActor("editor@example.com", "Sam");
  viewer = await makeActor("viewer@example.com", "Riley");
  stranger = await makeActor("stranger@example.com", "Eve");
  tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
  await grant(tripId, coOwner, "accepted", "owner");
  await grant(tripId, editor, "accepted", "editor");
  await grant(tripId, viewer, "accepted", "viewer");
  itemId = (await createItem(db(), owner, tripId, event({ bookingStatus: "needs_booking" }))).id;
  session.actor = null;
});

const memberId = async (who: Actor) =>
  (await db().selectFrom("trip_viewers").select("id").where("trip_id", "=", tripId).where("viewer_user_id", "=", who.userId).executeTakeFirstOrThrow()).id;

describe("what each role sees", () => {
  it("reports the role, whether you created the trip, and who did", async () => {
    const as = async (who: Actor) => (await getTripDetail(db(), who, tripId, NOW)).trip;
    expect(await as(owner)).toMatchObject({ role: "owner", primaryOwner: true, ownerName: null });
    expect(await as(coOwner)).toMatchObject({ role: "owner", primaryOwner: false, ownerName: "Link" });
    expect(await as(editor)).toMatchObject({ role: "editor", primaryOwner: false, ownerName: "Link" });
    expect(await as(viewer)).toMatchObject({ role: "viewer", primaryOwner: false, ownerName: "Link" });
    await expectHttp(getTripDetail(db(), stranger, tripId, NOW), 404);
  });

  it("lists the trip on each member's dashboard with their role, and booking counts only for those who can edit", async () => {
    const dash = (who: Actor) => getDashboard(db(), who, NOW);
    expect((await dash(owner)).trips[0]).toMatchObject({ role: "owner", primaryOwner: true });
    expect((await dash(coOwner)).trips[0]).toMatchObject({ role: "owner", primaryOwner: false });
    expect((await dash(editor)).trips[0]).toMatchObject({ role: "editor", primaryOwner: false });
    expect((await dash(viewer)).trips[0]).toMatchObject({ role: "viewer" });
    expect((await dash(stranger)).trips).toEqual([]);
    for (const who of [owner, coOwner, editor]) expect((await dash(who)).ownerBookingTasks.map((t) => t.itemId)).toEqual([itemId]);
    expect((await dash(viewer)).ownerBookingTasks).toEqual([]);
  });

  it("gives the highest role when someone has several accepted entries, and nothing for pending or revoked ones", async () => {
    // A second accepted entry for the same account under another invited address: the higher role wins.
    await db().insertInto("trip_viewers").values({
      trip_id: tripId, invitee_email_normalized: "riley.alt@example.com", viewer_user_id: viewer.userId, role: "editor", status: "accepted",
      invitation_token_hash: Buffer.from(crypto.randomUUID()), expires_at: new Date(Date.now() + 864e5), accepted_at: new Date(),
    }).execute();
    expect((await getTripDetail(db(), viewer, tripId, NOW)).trip.role).toBe("editor");
    const pendingOwner = await makeActor("pending@example.com", "Pending");
    const revokedOwner = await makeActor("revoked@example.com", "Revoked");
    await grant(tripId, pendingOwner, "pending", "owner");
    await grant(tripId, revokedOwner, "revoked", "owner");
    await expectHttp(getTripDetail(db(), pendingOwner, tripId, NOW), 404);
    await expectHttp(getTripDetail(db(), revokedOwner, tripId, NOW), 404);
  });
});

describe("changing events, bookings and notes", () => {
  it("lets owners, co-owners and editors do everything to events, and refuses viewers and strangers", async () => {
    for (const who of [owner, coOwner, editor]) {
      const created = await createItem(db(), who, tripId, event({ title: `By ${who.email}` }));
      const edited = await updateItem(db(), who, tripId, created.id, { item: event({ title: "Renamed" }), expectedVersion: created.version });
      const noted = await updateItemNotes(db(), who, tripId, created.id, { notes: "Bring cash", expectedVersion: edited.version });
      const booked = await updateItemBooking(db(), who, tripId, created.id, { bookingStatus: "booked", bookingDueDate: null, expectedVersion: noted.version });
      expect(booked.bookingStatus).toBe("booked");
      const copy = await duplicateItem(db(), who, tripId, created.id, booked.version);
      expect(copy.id).not.toBe(created.id);
      await deleteItem(db(), who, tripId, copy.id, copy.version);
      expect((await restoreItem(db(), who, tripId, copy.id, NOW)).id).toBe(copy.id);
    }
    const current = (await getTripDetail(db(), owner, tripId, NOW)).items.find((i) => i.id === itemId)!;
    for (const [who, status] of [[viewer, 403], [stranger, 404]] as const) {
      await expectHttp(createItem(db(), who, tripId, event()), status);
      await expectHttp(updateItem(db(), who, tripId, itemId, { item: event(), expectedVersion: current.version }), status);
      await expectHttp(updateItemNotes(db(), who, tripId, itemId, { notes: "x", expectedVersion: current.version }), status);
      await expectHttp(updateItemBooking(db(), who, tripId, itemId, { bookingStatus: "booked", bookingDueDate: null, expectedVersion: current.version }), status);
      await expectHttp(duplicateItem(db(), who, tripId, itemId, current.version), status);
      await expectHttp(deleteItem(db(), who, tripId, itemId, current.version), status);
      await expectHttp(restoreItem(db(), who, tripId, itemId, NOW), status);
    }
  });

  it("shares the concurrency rule: two editors cannot overwrite each other", async () => {
    const stale = (await getTripDetail(db(), editor, tripId, NOW)).items[0]!;
    await updateItemNotes(db(), coOwner, tripId, itemId, { notes: "Co-owner's note", expectedVersion: stale.version });
    await expectHttp(updateItemNotes(db(), editor, tripId, itemId, { notes: "Editor's note", expectedVersion: stale.version }), 409);
  });
});

describe("the trip itself and its sharing", () => {
  it("lets owners and co-owners change the trip, and keeps editors and viewers out", async () => {
    const detail = (await getTripDetail(db(), owner, tripId, NOW)).trip;
    const patch = { ...tripInput, title: "Renamed by a co-owner", expectedVersion: detail.version };
    const updated = await updateTrip(db(), coOwner, tripId, patch, NOW);
    expect(updated).toMatchObject({ title: "Renamed by a co-owner", role: "owner", primaryOwner: false, ownerName: "Link" });
    for (const [who, status] of [[editor, 403], [viewer, 403], [stranger, 404]] as const) {
      await expectHttp(updateTrip(db(), who, tripId, { ...tripInput, expectedVersion: detail.version + 1 }, NOW), status);
      await expectHttp(previewTimeZone(db(), who, tripId, "Europe/Paris", detail.version + 1, NOW), status);
      await expectHttp(deleteTrip(db(), who, tripId, detail.version + 1), status);
    }
    await expectHttp(previewTimeZone(db(), editor, tripId, "Europe/Paris", 1, NOW), 403);
  });

  it("lets a co-owner delete the trip", async () => {
    const version = (await getTripDetail(db(), owner, tripId, NOW)).trip.version;
    await deleteTrip(db(), coOwner, tripId, version);
    await expectHttp(getTripDetail(db(), owner, tripId, NOW), 404);
  });

  it("lets only owners and co-owners see and manage who the trip is shared with", async () => {
    for (const who of [owner, coOwner]) expect((await listInvitations(db(), who, tripId, NOW)).map((e) => e.role).sort()).toEqual(["editor", "owner", "viewer"]);
    for (const [who, status] of [[editor, 403], [viewer, 403], [stranger, 404]] as const) {
      await expectHttp(listInvitations(db(), who, tripId, NOW), status);
      await expectHttp(createInvitation(db(), who, tripId, "new@example.com", NOW, "owner"), status);
      await expectHttp(updateInvitationRole(db(), who, tripId, await memberId(viewer), "owner", NOW), status);
      await expectHttp(revokeInvitation(db(), who, tripId, await memberId(viewer), NOW), status);
    }
  });
});

describe("choosing and changing roles", () => {
  it("invites with a role, which applies once accepted, and a new link can change it", async () => {
    const link = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW, "editor");
    expect(link.invitation.role).toBe("editor");
    const again = await createInvitation(db(), coOwner, tripId, "newcomer@example.com", NOW, "owner");
    expect(again.invitationId).toBe(link.invitationId);
    expect(again.invitation.role).toBe("owner");
    const newcomer = await makeActor("newcomer@example.com", "New");
    await acceptInvitation(db(), newcomer, sha(again.invitationUrl.split("#")[1]!), NOW);
    expect((await getTripDetail(db(), newcomer, tripId, NOW)).trip.role).toBe("owner");
    await expectHttp(createInvitation(db(), owner, tripId, "newcomer@example.com", NOW, "viewer"), 409, "invitation_accepted");
  });

  it("applies a role change on the person's next request, in both directions", async () => {
    const id = await memberId(viewer);
    await expectHttp(createItem(db(), viewer, tripId, event()), 403);
    expect((await updateInvitationRole(db(), owner, tripId, id, "editor", NOW)).role).toBe("editor");
    await createItem(db(), viewer, tripId, event({ title: "Now they can" }));
    await expectHttp(updateTrip(db(), viewer, tripId, { ...tripInput, expectedVersion: (await getTripDetail(db(), owner, tripId, NOW)).trip.version }, NOW), 403);
    await updateInvitationRole(db(), owner, tripId, id, "owner", NOW);
    await updateTrip(db(), viewer, tripId, { ...tripInput, title: "Promoted", expectedVersion: (await getTripDetail(db(), owner, tripId, NOW)).trip.version }, NOW);
    await updateInvitationRole(db(), coOwner, tripId, id, "viewer", NOW);
    await expectHttp(createItem(db(), viewer, tripId, event()), 403);
  });

  it("lets a co-owner step down, and refuses unknown, malformed and revoked entries", async () => {
    await updateInvitationRole(db(), coOwner, tripId, await memberId(coOwner), "viewer", NOW);
    expect((await getTripDetail(db(), coOwner, tripId, NOW)).trip.role).toBe("viewer");
    await expectHttp(updateInvitationRole(db(), owner, tripId, crypto.randomUUID(), "editor", NOW), 404);
    await expectHttp(updateInvitationRole(db(), owner, tripId, "not-a-uuid", "editor", NOW), 404);
    await revokeInvitation(db(), owner, tripId, await memberId(editor), NOW);
    await expectHttp(updateInvitationRole(db(), owner, tripId, await memberId(editor), "owner", NOW), 409, "invitation_revoked");
    await expectHttp(getTripDetail(db(), editor, tripId, NOW), 404);
  });

  it("never lets a trip's route touch another trip's entries, even for someone who owns both", async () => {
    const other = (await createTrip(db(), owner, { ...tripInput, title: "Another trip" }, NOW)).id;
    const outsider = await makeActor("outsider@example.com", "Outsider");
    await grant(other, outsider, "accepted", "viewer");
    const theirs = (await db().selectFrom("trip_viewers").select("id").where("trip_id", "=", other).executeTakeFirstOrThrow()).id;
    await expectHttp(updateInvitationRole(db(), owner, tripId, theirs, "owner", NOW), 404);
    await expectHttp(revokeInvitation(db(), owner, tripId, theirs, NOW), 404);
    expect((await db().selectFrom("trip_viewers").select(["role", "status"]).where("id", "=", theirs).executeTakeFirstOrThrow())).toEqual({ role: "viewer", status: "accepted" });
    // And an owner of only one trip cannot reach the other trip at all.
    await expectHttp(updateInvitationRole(db(), coOwner, other, theirs, "owner", NOW), 404);
    await expectHttp(createItem(db(), editor, other, event()), 404);
  });

  it("validates roles at the route and lets only owners call it", async () => {
    const id = await memberId(viewer);
    session.actor = owner;
    expect((await memberRoute.PATCH(req("PATCH", { role: "superuser" }), ctx({ tripId, invitationId: id }))).status).toBe(422);
    expect((await memberRoute.PATCH(req("PATCH", { role: "editor", extra: 1 }), ctx({ tripId, invitationId: id }))).status).toBe(422);
    const ok = await memberRoute.PATCH(req("PATCH", { role: "editor" }), ctx({ tripId, invitationId: id }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id, role: "editor" });
    const created = await membersRoute.POST(req("POST", { email: "x@example.com", role: "nope" }), ctx({ tripId }));
    expect(created.status).toBe(422);
    const defaults = await membersRoute.POST(req("POST", { email: "y@example.com" }), ctx({ tripId }));
    expect(((await defaults.json()) as { invitation: { role: string } }).invitation.role).toBe("viewer");
    session.actor = editor;
    expect((await memberRoute.PATCH(req("PATCH", { role: "owner" }), ctx({ tripId, invitationId: id }))).status).toBe(403);
    session.actor = null;
    expect((await memberRoute.PATCH(req("PATCH", { role: "owner" }), ctx({ tripId, invitationId: id }))).status).toBe(401);
  });
});

describe("account-level helpers", () => {
  it("opens place search and lookup to editors and owners of some trip, not to viewers or strangers", async () => {
    const search = (who: Actor | null) => {
      session.actor = who;
      return places.GET(req("GET", undefined, `${ORIGIN}/api/atlas/places?q=Lisbon`));
    };
    for (const who of [owner, coOwner, editor]) expect((await search(who)).status).toBe(200);
    for (const who of [viewer, stranger]) expect((await search(who)).status).toBe(403);
    expect((await search(null)).status).toBe(401);
    // Lookup reaches the provider only after the guard; with no key configured, editors get "not configured" (503).
    const lookup = (who: Actor) => {
      session.actor = who;
      return resolve.POST(req("POST", { location: "Time Out Market", destination: "Lisbon" }));
    };
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    try {
      expect((await lookup(editor)).status).toBe(503);
      expect((await lookup(viewer)).status).toBe(403);
      expect((await lookup(stranger)).status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps creating trips and importing for the allowlist, whatever the trip role", async () => {
    await expectHttp(createTrip(db(), coOwner, tripInput, NOW), 403);
    await expectHttp(createTrip(db(), editor, tripInput, NOW), 403);
    session.actor = coOwner;
    expect((await importPreview.POST(req("POST", { responseText: "{}", ownerProvidedBudget: null }))).status).toBe(403);
  });

  it("blocks a creator removed from the allowlist but not a co-owner, who never needed it", async () => {
    const demoted = { ...owner, isOwner: false };
    await expectHttp(getTripDetail(db(), demoted, tripId, NOW), 404);
    expect((await getTripDetail(db(), coOwner, tripId, NOW)).trip.role).toBe("owner");
  });
});

describe("deleting an account", () => {
  it("removes a member's access but not the trip, and the trip stays with its other owners when the creator goes", async () => {
    await deleteAccount(db(), editor);
    expect((await getTripDetail(db(), owner, tripId, NOW)).trip.role).toBe("owner");
    expect((await listInvitations(db(), owner, tripId, NOW)).map((e) => e.email)).not.toContain("editor@example.com");
    await deleteAccount(db(), owner);
    // The co-owner keeps it, now without a creator; the viewer keeps theirs (more in account-deletion.test.ts).
    expect((await getTripDetail(db(), coOwner, tripId, NOW)).trip).toMatchObject({ role: "owner", primaryOwner: false, creatorGone: true, ownerName: null });
    expect((await getTripDetail(db(), viewer, tripId, NOW)).trip.role).toBe("viewer");
  });
});
