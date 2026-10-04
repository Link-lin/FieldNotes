import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { event, grant, makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { HttpError } from "@/server/core/http/errors";
import * as accountRepo from "@/server/modules/account/account.repository";
import { deleteAccount, listOwnedTrips } from "@/server/modules/account/account.service";
import { revokeInvitation, updateInvitationRole } from "@/server/modules/invitations/invitations.service";
import { createItem } from "@/server/modules/items/items.service";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";

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
const accountRoute = await import("@/app/api/account/route");
const ownedRoute = await import("@/app/api/account/owned-trips/route");

const ORIGIN = "http://localhost:3000";
const req = (method: string, body?: unknown) =>
  new Request(`${ORIGIN}/api/account`, { method, headers: { "content-type": "application/json", origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
const db = () => testDb();
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)); // join times a day apart

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected HTTP ${status}`).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

// owner and second are on the allowlist (see setup.ts); everyone else holds only grants.
let owner: Actor, second: Actor, coOwner: Actor, editor: Actor, viewer: Actor, other: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  second = await makeActor("second-owner@example.com", "Second");
  coOwner = await makeActor("coowner@example.com", "Jordan");
  editor = await makeActor("editor@example.com", "Sam");
  viewer = await makeActor("viewer@example.com", "Riley");
  other = await makeActor("other@example.com", "Eve");
  session.actor = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const newTrip = async (creator: Actor, title: string = tripInput.title) => (await createTrip(db(), creator, { ...tripInput, title }, NOW)).id;
/** A trip made by someone who can't create trips (not on the allowlist), which only a direct write can produce. */
async function tripBy(creator: Actor, title = "Made by someone off the allowlist") {
  return (
    await db()
      .insertInto("trips")
      .values({ owner_user_id: creator.userId, title, destination: "Lisbon", start_date: "2026-12-01", end_date: "2026-12-03", time_zone: "Europe/Lisbon", budget_amount: null, budget_currency: null, atlas_latitude: null, atlas_longitude: null, atlas_source: null })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}
const grantOf = async (tripId: string, who: Actor) =>
  (await db().selectFrom("trip_viewers").select("id").where("trip_id", "=", tripId).where("invitee_email_normalized", "=", who.email).executeTakeFirstOrThrow()).id;
const tripRow = (tripId: string) => db().selectFrom("trips").selectAll().where("id", "=", tripId).executeTakeFirst();
const userRow = (who: Actor) => db().selectFrom("User").select("id").where("id", "=", who.userId).executeTakeFirst();
const roleOn = async (who: Actor, tripId: string) => (await getTripDetail(db(), who, tripId, NOW)).trip.role;

/** Trips with no creator and no owner grant: nobody can open them, so they must never exist. */
const ownerless = () =>
  db()
    .selectFrom("trips")
    .select("id")
    .where("owner_user_id", "is", null)
    .where((eb) => eb.not(eb.exists(eb.selectFrom("trip_viewers").select("id").whereRef("trip_viewers.trip_id", "=", "trips.id").where("status", "=", "accepted").where("role", "=", "owner"))))
    .execute();

/** Time for a competing request, started while a deletion is held, to finish or to be seen waiting on its locks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

/** Holds a person's own deletion, after it has locked and read what they own, until `resume` is called. */
function pauseAfterOwnedRead(userId: string) {
  let reached!: () => void;
  let resume!: () => void;
  const atRead = new Promise<void>((resolve) => (reached = resolve));
  const released = new Promise<void>((resolve) => (resume = resolve));
  const original = accountRepo.ownedTripRows;
  vi.spyOn(accountRepo, "ownedTripRows").mockImplementation(async (conn, id, lock) => {
    const rows = await original(conn, id, lock);
    if (id === userId && lock) {
      reached();
      await released;
    }
    return rows;
  });
  return { atRead, resume };
}

describe("what the account-deletion dialog offers", () => {
  it("lists the people on a trip you created in the order ownership would pass, and who would keep it", async () => {
    const t = await newTrip(owner);
    await grant(t, viewer, "accepted", "viewer", day(1));
    await grant(t, editor, "accepted", "editor", day(2));
    await grant(t, coOwner, "accepted", "owner", day(3));
    await grant(t, other, "pending");
    await grant(t, second, "revoked");
    const plans = await listOwnedTrips(db(), owner);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: t, title: tripInput.title, otherOwners: ["coowner@example.com"] });
    expect(plans[0]!.people.map((p) => [p.name, p.role])).toEqual([
      ["coowner@example.com", "owner"],
      ["editor@example.com", "editor"],
      ["viewer@example.com", "viewer"],
    ]);
  });

  it("puts people of one role in the order they joined, and counts an account with two grants once, at its highest role", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor", day(5));
    await grant(t, viewer, "accepted", "editor", day(2));
    // The same account invited under a second address at a lower role is still one person.
    await db()
      .insertInto("trip_viewers")
      .values({ trip_id: t, invitee_email_normalized: "sam.again@example.com", viewer_user_id: editor.userId, role: "viewer", status: "accepted", invitation_token_hash: Buffer.from("again"), expires_at: day(30), accepted_at: day(1) })
      .execute();
    const [plan] = await listOwnedTrips(db(), owner);
    expect(plan!.people.map((p) => [p.name, p.role])).toEqual([
      ["viewer@example.com", "editor"],
      ["editor@example.com", "editor"],
    ]);
  });

  it("includes a trip you own only through a grant, and leaves out trips where you are an editor or viewer", async () => {
    const shared = await newTrip(second, "Second's trip");
    await grant(shared, owner, "accepted", "owner");
    await grant(shared, editor, "accepted", "editor", day(1));
    await grant(await newTrip(second, "Edit only"), owner, "accepted", "editor");
    await grant(await newTrip(second, "View only"), owner);
    const plans = await listOwnedTrips(db(), owner);
    expect(plans.map((p) => p.id)).toEqual([shared]);
    // Second made it and can still act as an owner, so it would stay with them.
    expect(plans[0]).toMatchObject({ otherOwners: ["Second"] });
    expect(plans[0]!.people.map((p) => p.name)).toEqual(["editor@example.com"]);
    expect(await listOwnedTrips(db(), editor)).toEqual([]);
  });

  it("doesn't count a creator who can't act as an owner, or a trip's own people when nobody has joined", async () => {
    const t = await tripBy(other);
    await grant(t, owner, "accepted", "owner");
    await grant(t, editor, "accepted", "editor");
    const alone = await newTrip(owner, "Alone");
    const plans = Object.fromEntries((await listOwnedTrips(db(), owner)).map((p) => [p.id, p]));
    expect(plans[t]).toMatchObject({ otherOwners: [] });
    expect(plans[t]!.people.map((p) => p.name)).toEqual(["editor@example.com"]);
    expect(plans[alone]).toMatchObject({ otherOwners: [], people: [] });
  });
});

describe("deleting an account", () => {
  it("leaves a trip with its other owners, clearing only its creator", async () => {
    const t = await newTrip(owner);
    await createItem(db(), owner, t, event());
    await grant(t, coOwner, "accepted", "owner", day(1));
    await grant(t, viewer, "accepted", "viewer", day(2));
    await db().insertInto("Session").values({ userId: owner.userId, sessionToken: "tok", expires: day(30) }).execute();
    await deleteAccount(db(), owner);
    expect(await userRow(owner)).toBeUndefined();
    expect(await tripRow(t)).toMatchObject({ owner_user_id: null });
    expect((await getTripDetail(db(), coOwner, t, NOW)).items).toHaveLength(1);
    expect(await roleOn(coOwner, t)).toBe("owner");
    expect(await roleOn(viewer, t)).toBe("viewer");
    expect(await db().selectFrom("Session").selectAll().execute()).toEqual([]);
  });

  it("asks about a trip nobody else owns when others are on it, and changes nothing until they choose", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor");
    const err = await deleteAccount(db(), owner).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: "account_decision_needed", fields: [{ path: `trips.${t}`, code: "decision_needed" }] });
    expect((err as HttpError).message).toContain(tripInput.title);
    expect(await userRow(owner)).toBeDefined();
    expect(await tripRow(t)).toMatchObject({ owner_user_id: owner.userId });
    expect(await roleOn(editor, t)).toBe("editor");
  });

  it("hands a trip to the chosen person, who becomes an owner, and keeps everyone else's role", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor", day(1));
    await grant(t, viewer, "accepted", "viewer", day(2));
    await deleteAccount(db(), owner, [{ tripId: t, action: "transfer", personId: await grantOf(t, viewer) }]);
    expect(await roleOn(viewer, t)).toBe("owner");
    expect(await roleOn(editor, t)).toBe("editor");
    expect((await getTripDetail(db(), viewer, t, NOW)).trip).toMatchObject({ creatorGone: true, primaryOwner: false, ownerName: null });
  });

  it("deletes a trip the person chose to delete, for everyone, with its events and import receipts", async () => {
    const t = await newTrip(owner);
    await createItem(db(), owner, t, event());
    await grant(t, editor, "accepted", "editor");
    await db().insertInto("import_receipts").values({ owner_user_id: owner.userId, idempotency_key: crypto.randomUUID(), payload_hash: Buffer.from("x"), trip_id: t }).execute();
    await deleteAccount(db(), owner, [{ tripId: t, action: "delete" }]);
    expect(await tripRow(t)).toBeUndefined();
    expect(await db().selectFrom("plan_items").selectAll().execute()).toEqual([]);
    expect(await db().selectFrom("trip_viewers").selectAll().execute()).toEqual([]);
    await expectHttp(getTripDetail(db(), editor, t, NOW), 404);
  });

  it("deletes a trip nobody else has joined, even with invitations still pending", async () => {
    const t = await newTrip(owner);
    await grant(t, other, "pending", "owner");
    await deleteAccount(db(), owner);
    expect(await tripRow(t)).toBeUndefined();
  });

  it("lets the person delete a trip another owner would have kept", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    await deleteAccount(db(), owner, [{ tripId: t, action: "delete" }]);
    expect(await tripRow(t)).toBeUndefined();
    await expectHttp(getTripDetail(db(), coOwner, t, NOW), 404);
  });

  it("keeps a trip with its other owners when the person says keep", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    await deleteAccount(db(), owner, [{ tripId: t, action: "keep" }]);
    expect(await roleOn(coOwner, t)).toBe("owner");
  });

  it("refuses to keep a trip whose other owner has since left, instead of deleting it", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    expect((await listOwnedTrips(db(), owner))[0]).toMatchObject({ otherOwners: ["coowner@example.com"] }); // the dialog says "Keep it"
    await deleteAccount(db(), coOwner);
    await expectHttp(deleteAccount(db(), owner, [{ tripId: t, action: "keep" }]), 409, "account_decision_needed");
    expect(await tripRow(t)).toBeDefined();
    expect(await userRow(owner)).toBeDefined();
  });

  it("rejects choices that are out of date, and changes nothing", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor");
    await grant(t, other, "pending");
    const elsewhere = await newTrip(second);
    await grant(elsewhere, viewer);
    const bad = [
      [{ tripId: elsewhere, action: "delete" as const }], // not a trip you own
      [{ tripId: t, action: "transfer" as const, personId: crypto.randomUUID() }], // nobody by that id
      [{ tripId: t, action: "transfer" as const, personId: await grantOf(elsewhere, viewer) }], // someone on another trip
      [{ tripId: t, action: "transfer" as const, personId: await grantOf(t, other) }], // an invitation nobody has accepted
    ];
    for (const decisions of bad) await expectHttp(deleteAccount(db(), owner, decisions), 422, "validation_error");
    expect(await userRow(owner)).toBeDefined();
    expect(await tripRow(t)).toBeDefined();
    expect(await tripRow(elsewhere)).toBeDefined();
  });

  it("settles several trips in one go", async () => {
    const kept = await newTrip(owner, "Kept");
    await grant(kept, coOwner, "accepted", "owner");
    const handed = await newTrip(owner, "Handed over");
    await grant(handed, editor, "accepted", "editor", day(1));
    await grant(handed, viewer, "accepted", "viewer", day(2));
    const removed = await newTrip(owner, "Removed");
    await grant(removed, viewer);
    const alone = await newTrip(owner, "Alone");
    await deleteAccount(db(), owner, [
      { tripId: handed, action: "transfer", personId: await grantOf(handed, editor) },
      { tripId: removed, action: "delete" },
    ]);
    expect(await tripRow(kept)).toBeDefined();
    expect(await tripRow(handed)).toBeDefined();
    expect(await tripRow(removed)).toBeUndefined();
    expect(await tripRow(alone)).toBeUndefined();
    expect(await roleOn(editor, handed)).toBe("owner");
  });

  it("asks a grant owner as well when the creator can no longer act as an owner", async () => {
    const t = await tripBy(other);
    await grant(t, coOwner, "accepted", "owner", day(1));
    await grant(t, editor, "accepted", "editor", day(2));
    await expectHttp(deleteAccount(db(), coOwner), 409, "account_decision_needed");
    await deleteAccount(db(), coOwner, [{ tripId: t, action: "transfer", personId: await grantOf(t, editor) }]);
    expect(await roleOn(editor, t)).toBe("owner");
    expect(await userRow(coOwner)).toBeUndefined();
  });

  it("lets a co-owner leave without a decision while the creator can still act as an owner", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    await grant(t, editor, "accepted", "editor");
    await deleteAccount(db(), coOwner);
    expect(await roleOn(owner, t)).toBe("owner");
    expect(await roleOn(editor, t)).toBe("editor");
  });

  it("removes the person's grants on other people's trips and leaves those trips alone", async () => {
    const theirs = await newTrip(second);
    await grant(theirs, owner, "accepted", "editor");
    await deleteAccount(db(), owner);
    expect(await tripRow(theirs)).toBeDefined();
    expect(await db().selectFrom("trip_viewers").selectAll().execute()).toEqual([]);
  });
});

describe("changes made while an account is being deleted", () => {
  it("won't strand a trip created for an account that is being deleted", async () => {
    const pause = pauseAfterOwnedRead(owner.userId);
    const deleting = deleteAccount(db(), owner);
    await pause.atRead;
    // The insert waits for the deletion's lock on the account, then is refused once the account is gone.
    const creating = createTrip(db(), owner, tripInput, NOW).then(() => "created", () => "refused");
    await settle(); // without that lock the trip would be created here, before the deletion carries on
    pause.resume();
    await deleting;
    await creating;
    expect(await ownerless()).toEqual([]);
  });

  it("refuses a handover to someone who is deleting their own account at the same moment", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor", day(1));
    await grant(t, viewer, "accepted", "viewer", day(2));
    const person = await grantOf(t, editor);
    const pause = pauseAfterOwnedRead(editor.userId);
    const leaving = deleteAccount(db(), editor);
    await pause.atRead;
    const handing = deleteAccount(db(), owner, [{ tripId: t, action: "transfer", personId: person }]).then(() => null, (e: unknown) => e);
    await settle(); // without the lock on the new owner the handover would complete here
    pause.resume();
    await leaving;
    const err = await handing;
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 422, fields: [{ path: `trips.${t}`, code: "person_unavailable" }] });
    expect(await ownerless()).toEqual([]);
    expect(await userRow(owner)).toBeDefined(); // nothing of the owner's was deleted
    expect(await roleOn(owner, t)).toBe("owner");
  });

  it("lets only one of two co-owners leave at the same moment, so the trip keeps an owner", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner", day(1));
    await grant(t, other, "accepted", "owner", day(2));
    await grant(t, viewer, "accepted", "viewer", day(3));
    await deleteAccount(db(), owner); // the creator goes first; the co-owners keep it
    const pause = pauseAfterOwnedRead(coOwner.userId);
    const first = deleteAccount(db(), coOwner);
    await pause.atRead;
    const second = deleteAccount(db(), other).then(() => null, (e: unknown) => e);
    await settle(); // without the trip lock the second would leave here too
    pause.resume();
    await first;
    const err = await second;
    expect(err).toMatchObject({ status: 409, code: "account_decision_needed" });
    expect(await ownerless()).toEqual([]);
    expect(await userRow(other)).toBeDefined();
    expect(await roleOn(other, t)).toBe("owner");
  });
});

describe("a trip always keeps an owner", () => {
  it("refuses to demote or revoke the last owner once the creator has left", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    await deleteAccount(db(), owner);
    const id = await grantOf(t, coOwner);
    await expectHttp(updateInvitationRole(db(), coOwner, t, id, "editor", NOW), 409, "last_owner");
    await expectHttp(revokeInvitation(db(), coOwner, t, id, NOW), 409, "last_owner");
    expect(await roleOn(coOwner, t)).toBe("owner");
    // An invitation nobody has accepted is no owner yet, so it can still be withdrawn.
    await grant(t, other, "pending", "owner");
    await revokeInvitation(db(), coOwner, t, await grantOf(t, other), NOW);
    // With a second owner either can step down, until one is left.
    await grant(t, editor, "accepted", "owner");
    await updateInvitationRole(db(), coOwner, t, id, "editor", NOW);
    expect(await roleOn(editor, t)).toBe("owner");
    await expectHttp(revokeInvitation(db(), editor, t, await grantOf(t, editor), NOW), 409, "last_owner");
  });

  it("lets an owner step down or be revoked while the creator can still act as an owner", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    const id = await grantOf(t, coOwner);
    await updateInvitationRole(db(), coOwner, t, id, "viewer", NOW);
    await updateInvitationRole(db(), owner, t, id, "owner", NOW);
    await revokeInvitation(db(), owner, t, id, NOW);
  });

  it("doesn't count a creator who is no longer on the allowlist", async () => {
    const t = await newTrip(owner);
    await grant(t, coOwner, "accepted", "owner");
    vi.stubEnv("TRIP_OWNER_EMAILS", "second-owner@example.com");
    await expectHttp(updateInvitationRole(db(), coOwner, t, await grantOf(t, coOwner), "editor", NOW), 409, "last_owner");
  });
});

describe("the account routes", () => {
  it("lists the signed-in person's own trips and needs a session", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor");
    expect((await ownedRoute.GET(req("GET"))).status).toBe(401);
    session.actor = owner;
    const res = await ownedRoute.GET(req("GET"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toMatchObject([{ id: t, otherOwners: [], people: [{ name: "editor@example.com", role: "editor" }] }]);
    session.actor = second;
    expect(await (await ownedRoute.GET(req("GET"))).json()).toEqual([]);
  });

  it("answers 409 naming the trips that need a choice, then deletes the account and clears the cookie once they are chosen", async () => {
    const t = await newTrip(owner);
    await grant(t, editor, "accepted", "editor");
    session.actor = owner;
    const refused = await accountRoute.DELETE(req("DELETE", { confirm: "DELETE" }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "account_decision_needed", fields: [{ path: `trips.${t}` }] } });
    expect(await userRow(owner)).toBeDefined();
    const done = await accountRoute.DELETE(req("DELETE", { confirm: "DELETE", trips: [{ tripId: t, action: "transfer", personId: await grantOf(t, editor) }] }));
    expect(done.status).toBe(204);
    expect(done.headers.getSetCookie().join(";")).toContain("authjs.session-token=;");
    expect(await roleOn(editor, t)).toBe("owner");
  });

  it("refuses unknown actions, two choices for one trip and a missing confirmation", async () => {
    const t = await newTrip(owner);
    session.actor = owner;
    const send = (body: unknown) => accountRoute.DELETE(req("DELETE", body));
    expect((await send({ confirm: "DELETE", trips: [{ tripId: t, action: "archive" }] })).status).toBe(422);
    expect((await send({ confirm: "DELETE", trips: [{ tripId: t, action: "delete" }, { tripId: t, action: "delete" }] })).status).toBe(422);
    expect((await send({ confirm: "DELETE", trips: [{ tripId: "nope", action: "delete" }] })).status).toBe(422);
    expect((await send({ trips: [] })).status).toBe(422);
    expect(await userRow(owner)).toBeDefined();
  });
});
