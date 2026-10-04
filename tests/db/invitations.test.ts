import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { acceptInvitation, createInvitation, listInvitations, revokeInvitation, stageInvitation } from "@/server/modules/invitations/invitations.service";
import { allowSignIn } from "@/server/auth/sign-in-gate";
import { actorFor, type Actor } from "@/server/auth/actor";
import { HttpError } from "@/server/core/http/errors";

// Route handlers run end to end with only the session lookup replaced.
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

const list = await import("@/app/api/trips/[tripId]/invitations/route");
const one = await import("@/app/api/trips/[tripId]/invitations/[invitationId]/route");
const stage = await import("@/app/api/invitations/stage/route");
const accept = await import("@/app/api/invitations/accept/route");

const ORIGIN = "http://localhost:3000";
const COOKIE = "fieldnotes-invite";
const req = (method: string, body?: unknown, opts: { origin?: string | null; cookie?: string } = {}) => {
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  return new Request(`${ORIGIN}/api/x`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const db = () => testDb();
const tokenOf = (url: string) => url.split("#")[1]!;
const sha = (token: string) => createHash("sha256").update(token).digest();
const later = (days: number) => new Date(NOW.getTime() + days * 864e5);

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

let owner: Actor, viewer: Actor, stranger: Actor, tripId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  viewer = await makeActor("viewer@example.com", "Sam");
  stranger = await makeActor("stranger@example.com", "Eve");
  tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
  session.actor = null;
});

describe("invitation service", () => {
  it("returns a one-time link and stores only the token's hash, with a seven-day expiry", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    expect(link.invitationUrl).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/);
    expect(link.expiresAt).toBe(later(7).toISOString());
    expect(link.invitation).toEqual({ id: link.invitationId, email: "viewer@example.com", role: "viewer", status: "pending", expiresAt: link.expiresAt, acceptedAt: null, revokedAt: null });
    const rows = await db().selectFrom("trip_viewers").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.invitation_token_hash).toEqual(sha(tokenOf(link.invitationUrl)));
    expect(JSON.stringify(rows)).not.toContain(tokenOf(link.invitationUrl));
    const listed = JSON.stringify(await listInvitations(db(), owner, tripId, NOW));
    expect(listed).not.toContain(tokenOf(link.invitationUrl));
    expect(listed).not.toContain(sha(tokenOf(link.invitationUrl)).toString("hex"));
  });

  it("lets only the owner invite, list and revoke", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    await acceptInvitation(db(), viewer, sha(tokenOf(link.invitationUrl)), NOW);
    await expectHttp(createInvitation(db(), viewer, tripId, "friend@example.com", NOW), 403);
    await expectHttp(listInvitations(db(), viewer, tripId, NOW), 403);
    await expectHttp(revokeInvitation(db(), viewer, tripId, link.invitationId, NOW), 403);
    await expectHttp(createInvitation(db(), stranger, tripId, "friend@example.com", NOW), 404);
    await expectHttp(listInvitations(db(), stranger, tripId, NOW), 404);
  });

  it("refuses the owner's own email and an accepted viewer until revoked", async () => {
    await expectHttp(createInvitation(db(), owner, tripId, "owner@example.com", NOW), 422);
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    await acceptInvitation(db(), viewer, sha(tokenOf(link.invitationUrl)), NOW);
    await expectHttp(createInvitation(db(), owner, tripId, "viewer@example.com", NOW), 409, "invitation_accepted");
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    const again = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    expect(again.invitationId).toBe(link.invitationId);
    const row = await db().selectFrom("trip_viewers").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "pending", viewer_user_id: null, accepted_at: null, revoked_at: null });
  });

  it("gives a new link that invalidates the previous one, for pending, expired and revoked entries", async () => {
    const first = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    const second = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    expect(second.invitationId).toBe(first.invitationId);
    await expectHttp(stageInvitation(db(), tokenOf(first.invitationUrl), NOW), 404, "invitation_invalid");
    expect(await stageInvitation(db(), tokenOf(second.invitationUrl), NOW)).toEqual(sha(tokenOf(second.invitationUrl)));

    expect((await listInvitations(db(), owner, tripId, later(8)))[0]!.status).toBe("expired");
    const renewed = await createInvitation(db(), owner, tripId, "viewer@example.com", later(8));
    expect(renewed.invitation.status).toBe("pending");
    expect(renewed.expiresAt).toBe(later(15).toISOString());
  });

  it("stages only usable links and never reveals why a link is unusable", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    const token = tokenOf(link.invitationUrl);
    await expectHttp(stageInvitation(db(), "not-a-token", NOW), 404, "invitation_invalid");
    await expectHttp(stageInvitation(db(), "A".repeat(43), NOW), 404, "invitation_invalid");
    await expectHttp(stageInvitation(db(), token, later(7)), 404, "invitation_invalid");
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    await expectHttp(stageInvitation(db(), token, NOW), 404, "invitation_invalid");
  });

  it("accepts only the invited account, and only once", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    const hash = sha(tokenOf(link.invitationUrl));
    await expectHttp(acceptInvitation(db(), stranger, hash, NOW), 403, "invitation_wrong_account");
    expect((await db().selectFrom("trip_viewers").select("status").executeTakeFirstOrThrow()).status).toBe("pending");
    await expectHttp(acceptInvitation(db(), viewer, null, NOW), 404, "invitation_invalid");
    await expectHttp(acceptInvitation(db(), viewer, hash, later(7)), 404, "invitation_invalid");

    expect(await acceptInvitation(db(), viewer, hash, NOW)).toEqual({ tripId });
    expect(await acceptInvitation(db(), viewer, hash, later(30))).toEqual({ tripId });
    await expectHttp(acceptInvitation(db(), stranger, hash, NOW), 404, "invitation_invalid");
    expect((await getTripDetail(db(), viewer, tripId, NOW)).trip.role).toBe("viewer");
    expect((await listInvitations(db(), owner, tripId, NOW))[0]).toMatchObject({ status: "accepted", acceptedAt: NOW.toISOString(), expiresAt: null });
  });

  it("lets the bound account reopen an accepted link, and no one else", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    const token = tokenOf(link.invitationUrl);
    await acceptInvitation(db(), viewer, await stageInvitation(db(), token, NOW), NOW);
    // Staging still works after acceptance, even past the original expiry.
    const again = await stageInvitation(db(), token, later(30));
    expect(await acceptInvitation(db(), viewer, again, later(30))).toEqual({ tripId });
    await expectHttp(acceptInvitation(db(), stranger, again, later(30)), 404, "invitation_invalid");
  });

  it("binds a link to one account when accepts race", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    const hash = sha(tokenOf(link.invitationUrl));
    const results = await Promise.all([acceptInvitation(db(), viewer, hash, NOW), acceptInvitation(db(), viewer, hash, NOW)]);
    expect(results).toEqual([{ tripId }, { tripId }]);
    const rows = await db().selectFrom("trip_viewers").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "accepted", viewer_user_id: viewer.userId });
  });

  it("revocation blocks the next read and hides the trip from the viewer's dashboard", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    await acceptInvitation(db(), viewer, sha(tokenOf(link.invitationUrl)), NOW);
    expect((await getDashboard(db(), viewer, NOW)).trips.map((t) => t.id)).toEqual([tripId]);
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    await expectHttp(getTripDetail(db(), viewer, tripId, NOW), 404);
    expect((await getDashboard(db(), viewer, NOW)).trips).toEqual([]);
    await expectHttp(acceptInvitation(db(), viewer, sha(tokenOf(link.invitationUrl)), NOW), 404, "invitation_invalid");
    const row = await db().selectFrom("trip_viewers").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "revoked", invitation_token_hash: null, revoked_at: NOW });
    // Revoking again is harmless; an unknown ID is 404.
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    await expectHttp(revokeInvitation(db(), owner, tripId, crypto.randomUUID(), NOW), 404);
    await expectHttp(revokeInvitation(db(), owner, tripId, "nope", NOW), 404);
  });

  it("keeps an accepted viewer's access after their email changes", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com", NOW);
    await acceptInvitation(db(), viewer, sha(tokenOf(link.invitationUrl)), NOW);
    const renamed = await db().updateTable("User").set({ email: "sam@new.example" }).where("id", "=", viewer.userId).returning(["id", "email"]).executeTakeFirstOrThrow();
    expect((await getTripDetail(db(), actorFor(renamed), tripId, NOW)).trip.role).toBe("viewer");
  });

  it("matches Gmail addresses whatever the dots, +tag or googlemail.com spelling, and no other domain", async () => {
    const link = await createInvitation(db(), owner, tripId, "jane.doe+trip@gmail.com", NOW);
    const hash = sha(tokenOf(link.invitationUrl));
    // Google signs the account in as "janedoe@googlemail.com"; it is the invited person.
    const jane = await makeActor("janedoe@googlemail.com", "Jane");
    await acceptInvitation(db(), jane, hash, NOW);
    expect((await getTripDetail(db(), jane, tripId, NOW)).trip.role).toBe("viewer");
    // The same trick on another domain is a different person and stays refused.
    const plain = await createInvitation(db(), owner, tripId, "sam.rivera@example.com", NOW);
    const other = await makeActor("samrivera@example.com", "Sam");
    await expectHttp(acceptInvitation(db(), other, sha(tokenOf(plain.invitationUrl)), NOW), 403, "invitation_wrong_account");
    // Gmail names that really differ stay refused too.
    const near = await createInvitation(db(), owner, tripId, "sam.rivera@gmail.com", NOW);
    await expectHttp(acceptInvitation(db(), await makeActor("samrivera2@gmail.com", "Sam 2"), sha(tokenOf(near.invitationUrl)), NOW), 403, "invitation_wrong_account");
  });

  it("keeps one entry per person across spellings, and refuses the owner's own address in any spelling", async () => {
    const first = await createInvitation(db(), owner, tripId, "jane.doe@gmail.com", NOW);
    const again = await createInvitation(db(), owner, tripId, "janedoe+x@googlemail.com", NOW);
    expect(again.invitationId).toBe(first.invitationId); // a new link in the same entry, not a second person
    expect(await listInvitations(db(), owner, tripId, NOW)).toHaveLength(1);
    await expectHttp(stageInvitation(db(), tokenOf(first.invitationUrl), NOW), 404); // the old link no longer works
    const hash = sha(tokenOf(again.invitationUrl));
    await acceptInvitation(db(), await makeActor("janedoe@gmail.com", "Jane"), hash, NOW);
    await expectHttp(createInvitation(db(), owner, tripId, "j.anedoe@gmail.com", NOW), 409, "invitation_accepted");
    const ownerGmail = await makeActor("my.owner@gmail.com", "Mine");
    const t2 = (await createTrip(db(), { ...ownerGmail, isOwner: true }, tripInput, NOW)).id;
    await expectHttp(createInvitation(db(), { ...ownerGmail, isOwner: true }, t2, "myowner+me@googlemail.com", NOW), 422, "validation_error");
  });

  it("admits a new account for a pending invitation only while it can be accepted", async () => {
    const attempt = { provider: "google", providerAccountId: "sub-new", email: "new@example.com", emailVerified: true };
    expect(await allowSignIn(db(), attempt, NOW)).toBe(false);
    const link = await createInvitation(db(), owner, tripId, "new@example.com", NOW);
    expect(await allowSignIn(db(), attempt, NOW)).toBe(true);
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    expect(await allowSignIn(db(), attempt, NOW)).toBe(false);
  });

  it("admits a new Gmail identity for an invitation typed with other dots or a +tag, but not another domain's lookalike", async () => {
    const gmail = (email: string) => ({ provider: "google", providerAccountId: `sub-${email}`, email, emailVerified: true });
    await createInvitation(db(), owner, tripId, "jane.doe+trip@gmail.com", NOW);
    expect(await allowSignIn(db(), gmail("janedoe@gmail.com"), NOW)).toBe(true);
    expect(await allowSignIn(db(), gmail("Jane.Doe@googlemail.com"), NOW)).toBe(true);
    expect(await allowSignIn(db(), gmail("janedoe2@gmail.com"), NOW)).toBe(false);
    expect(await allowSignIn(db(), gmail("janedoe@example.com"), NOW)).toBe(false);
    await createInvitation(db(), owner, tripId, "kim.lee@example.com", NOW);
    expect(await allowSignIn(db(), gmail("kimlee@example.com"), NOW)).toBe(false);
    expect(await allowSignIn(db(), gmail("kim.lee@example.com"), NOW)).toBe(true);
    expect(await allowSignIn(db(), { ...gmail("janedoe@gmail.com"), emailVerified: false }, NOW)).toBe(false);
    expect(await allowSignIn(db(), gmail("janedoe@gmail.com"), later(8))).toBe(false); // expired
  });
});

describe("invitation routes", () => {
  it("normalizes a typed Gmail address, keeps its spelling, and treats another spelling as the same person", async () => {
    session.actor = owner;
    const p = ctx({ tripId });
    const first = await list.POST(req("POST", { email: "  Jane.Doe+Trip@Gmail.com " }), p);
    expect(first.status).toBe(201);
    const created = (await first.json()) as { invitationId: string; invitation: { email: string } };
    expect(created.invitation.email).toBe("jane.doe+trip@gmail.com");
    const second = await list.POST(req("POST", { email: "JANEDOE@googlemail.com" }), p);
    expect(((await second.json()) as { invitationId: string }).invitationId).toBe(created.invitationId);
    const entries = (await (await list.GET(req("GET"), p)).json()) as Array<{ email: string }>;
    expect(entries.map((e) => e.email)).toEqual(["jane.doe+trip@gmail.com"]);
  });

  it("need a session for every owner and accept route (ACCESS-7)", async () => {
    const p = ctx({ tripId });
    for (const r of [
      await list.GET(req("GET"), p),
      await list.POST(req("POST", { email: "viewer@example.com" }), p),
      await one.DELETE(req("DELETE"), ctx({ tripId, invitationId: crypto.randomUUID() })),
      await accept.POST(req("POST")),
    ]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("create, list and revoke through the API; the link is returned once", async () => {
    session.actor = owner;
    const bad = await list.POST(req("POST", { email: "not an email" }), ctx({ tripId }));
    expect(bad.status).toBe(422);
    const created = await list.POST(req("POST", { email: "  Viewer@Example.com " }), ctx({ tripId }));
    expect(created.status).toBe(201);
    const body = (await created.json()) as { invitationId: string; invitationUrl: string; invitation: { email: string } };
    expect(body.invitation.email).toBe("viewer@example.com");
    const listed = await list.GET(req("GET"), ctx({ tripId }));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toContain("no-store");
    const text = await listed.text();
    expect(text).not.toContain(tokenOf(body.invitationUrl));
    expect(text).not.toContain("invite#");
    expect((await one.DELETE(req("DELETE"), ctx({ tripId, invitationId: body.invitationId }))).status).toBe(204);
    expect((await one.DELETE(req("DELETE", undefined, { origin: "https://evil.example" }), ctx({ tripId, invitationId: body.invitationId }))).status).toBe(403);

    session.actor = viewer;
    expect((await list.GET(req("GET"), ctx({ tripId }))).status).toBe(404);
  });

  it("stages without a session, sets only the hash in an HttpOnly cookie, and returns no trip details", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com");
    const token = tokenOf(link.invitationUrl);
    expect((await stage.POST(req("POST", { token }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await stage.POST(req("POST", { token }, { origin: null }))).status).toBe(403);

    const r = await stage.POST(req("POST", { token }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const text = await r.text();
    expect(text).toBe(JSON.stringify({ staged: true }));
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toBe(`${COOKIE}=${sha(token).toString("hex")}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax`);
    expect(cookie).not.toContain(token);

    const bad = await stage.POST(req("POST", { token: "A".repeat(43) }));
    expect(bad.status).toBe(404);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect(await bad.text()).not.toContain(tripInput.title);
  });

  it("limits the public staging body to 1 MiB", async () => {
    const r = await stage.POST(req("POST", { token: "x".repeat(1_100_000) }));
    expect(r.status).toBe(413);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("accepts with the staged cookie, clears it, and leaves a wrong account's invitation pending", async () => {
    const link = await createInvitation(db(), owner, tripId, "viewer@example.com");
    const cookie = `other=1; ${COOKIE}=${sha(tokenOf(link.invitationUrl)).toString("hex")}`;

    session.actor = stranger;
    const wrong = await accept.POST(req("POST", undefined, { cookie }));
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { code: string; message: string } }).error.code).toBe("invitation_wrong_account");
    expect(wrong.headers.get("set-cookie")).toBeNull();

    session.actor = viewer;
    expect((await accept.POST(req("POST", undefined, { cookie, origin: null }))).status).toBe(403);
    expect((await accept.POST(req("POST"))).status).toBe(404);
    const ok = await accept.POST(req("POST", undefined, { cookie }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ tripId });
    expect(ok.headers.get("set-cookie")).toBe(`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  });
});
