import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, makeActor, makeActorWithoutEmail, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { allowSignIn } from "@/server/auth/sign-in-gate";
import { HttpError } from "@/server/core/http/errors";
import {
  acceptInvitation,
  createInvitation,
  createLinkInvitation,
  listInvitations,
  renewInvitation,
  revokeInvitation,
  stageInvitation,
  updateInvitationRole,
} from "@/server/modules/invitations/invitations.service";
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
const list = await import("@/app/api/trips/[tripId]/invitations/route");
const renewRoute = await import("@/app/api/trips/[tripId]/invitations/[invitationId]/link/route");

const ORIGIN = "http://localhost:3000";
const req = (method: string, body?: unknown) =>
  new Request(`${ORIGIN}/api/x`, { method, headers: { "content-type": "application/json", origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
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

let owner: Actor, editor: Actor, google: Actor, mei: Actor, tripId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link Lin");
  editor = await makeActor("editor@example.com", "Sam");
  google = await makeActor("someone@gmail.com", "Someone");
  mei = await makeActorWithoutEmail("Mei (WeChat)");
  tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
  session.actor = null;
});

describe("inviting by link", () => {
  it("makes an entry with a label and no address, and returns a link that works once", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei, on WeChat", NOW, "editor");
    expect(link.delivery).toBe("off");
    expect(link.invitationUrl).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/);
    expect(link.expiresAt).toBe(later(7).toISOString());
    expect(link.invitation).toEqual({ id: link.invitationId, email: null, label: "Mei, on WeChat", joinedAs: null, role: "editor", status: "pending", expiresAt: link.expiresAt, acceptedAt: null, revokedAt: null });
    const row = await db().selectFrom("trip_viewers").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ invitee_email_normalized: null, label: "Mei, on WeChat" });
    expect(row.invitation_token_hash).toEqual(sha(tokenOf(link.invitationUrl))); // only the hash is stored
    expect(JSON.stringify(await listInvitations(db(), owner, tripId, NOW))).not.toContain(tokenOf(link.invitationUrl));
  });

  it("is for owners only", async () => {
    await db().insertInto("trip_viewers").values({ trip_id: tripId, invitee_email_normalized: "editor@example.com", viewer_user_id: editor.userId, role: "editor", status: "accepted", invitation_token_hash: Buffer.from("x"), expires_at: later(7), accepted_at: NOW }).execute();
    await expectHttp(createLinkInvitation(db(), editor, tripId, "Mei", NOW), 403);
    await expectHttp(createLinkInvitation(db(), google, tripId, "Mei", NOW), 404);
  });

  it("is admitted by whoever opens it first, whatever their address, and takes the chosen role", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW, "editor");
    await createItem(db(), owner, tripId, event());
    const joined = await acceptInvitation(db(), mei, sha(tokenOf(link.invitationUrl)), NOW); // signed in with WeChat: no address at all
    expect(joined).toEqual({ tripId });
    expect((await getTripDetail(db(), mei, tripId, NOW)).trip).toMatchObject({ role: "editor", ownerName: "Link Lin" });
    await createItem(db(), mei, tripId, event({ title: "Added by Mei" }));
    expect(await listInvitations(db(), owner, tripId, NOW)).toEqual([
      expect.objectContaining({ label: "Mei", email: null, status: "accepted", role: "editor", joinedAs: "Mei (WeChat)", expiresAt: null }),
    ]);
  });

  it("works for a Google account too, which the address check would have turned away", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "A friend", NOW);
    await acceptInvitation(db(), google, sha(tokenOf(link.invitationUrl)), NOW);
    expect((await getTripDetail(db(), google, tripId, NOW)).trip.role).toBe("viewer");
  });

  it("can be used once, and the second person gets the generic answer", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const hash = sha(tokenOf(link.invitationUrl));
    await acceptInvitation(db(), mei, hash, NOW);
    await expectHttp(acceptInvitation(db(), google, hash, NOW), 404, "invitation_invalid");
    await expectHttp(getTripDetail(db(), google, tripId, NOW), 404);
    // The person who joined can open the same link again and land on the trip.
    expect(await acceptInvitation(db(), mei, hash, NOW)).toEqual({ tripId });
  });

  it("stops working when it expires or is revoked", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const token = tokenOf(link.invitationUrl);
    await expectHttp(stageInvitation(db(), token, later(7)), 404, "invitation_invalid");
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    await expectHttp(stageInvitation(db(), token, NOW), 404, "invitation_invalid");
    await expectHttp(acceptInvitation(db(), mei, sha(token), NOW), 404, "invitation_invalid");
  });

  it("gets a new link that replaces the old one, keeping its label and role", async () => {
    const first = await createLinkInvitation(db(), owner, tripId, "Mei", NOW, "editor");
    const renewed = await renewInvitation(db(), owner, tripId, first.invitationId, later(8)); // after the first link expired
    expect(renewed.invitationId).toBe(first.invitationId);
    expect(renewed.invitation).toMatchObject({ label: "Mei", role: "editor", status: "pending" });
    expect(renewed.expiresAt).toBe(later(15).toISOString());
    await expectHttp(stageInvitation(db(), tokenOf(first.invitationUrl), later(8)), 404);
    expect(await stageInvitation(db(), tokenOf(renewed.invitationUrl), later(8))).toEqual(sha(tokenOf(renewed.invitationUrl)));
    expect(await listInvitations(db(), owner, tripId, later(8))).toHaveLength(1);
  });

  it("can't be renewed once accepted, and an email entry is renewed by sending it again", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    await acceptInvitation(db(), mei, sha(tokenOf(link.invitationUrl)), NOW);
    await expectHttp(renewInvitation(db(), owner, tripId, link.invitationId, NOW), 409, "invitation_accepted");
    const byEmail = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW);
    await expectHttp(renewInvitation(db(), owner, tripId, byEmail.invitationId, NOW), 409, "invitation_by_email");
    await expectHttp(renewInvitation(db(), owner, tripId, crypto.randomUUID(), NOW), 404);
    await expectHttp(renewInvitation(db(), editor, tripId, link.invitationId, NOW), 404);
  });

  it("can have its role changed and its access revoked like any other entry", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    await acceptInvitation(db(), mei, sha(tokenOf(link.invitationUrl)), NOW);
    expect((await updateInvitationRole(db(), owner, tripId, link.invitationId, "editor", NOW)).role).toBe("editor");
    expect((await getTripDetail(db(), mei, tripId, NOW)).trip.role).toBe("editor");
    await revokeInvitation(db(), owner, tripId, link.invitationId, NOW);
    await expectHttp(getTripDetail(db(), mei, tripId, NOW), 404);
    expect((await listInvitations(db(), owner, tripId, NOW))[0]).toMatchObject({ status: "revoked", joinedAs: null, label: "Mei" });
  });

  it("counts as an owner once accepted, so it can be the last one left", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW, "owner");
    await acceptInvitation(db(), mei, sha(tokenOf(link.invitationUrl)), NOW);
    await db().updateTable("trips").set({ owner_user_id: null }).where("id", "=", tripId).execute(); // the creator has left
    await expectHttp(updateInvitationRole(db(), mei, tripId, link.invitationId, "viewer", NOW), 409, "last_owner");
  });
});

describe("the invitation routes", () => {
  it("create an entry by label or by email, and refuse both, neither and a bad label", async () => {
    session.actor = owner;
    const p = ctx({ tripId });
    const byLabel = await list.POST(req("POST", { label: "  Mei, on WeChat  ", role: "editor" }), p);
    expect(byLabel.status).toBe(201);
    expect(await byLabel.json()).toMatchObject({ delivery: "off", invitation: { label: "Mei, on WeChat", email: null, role: "editor" } });
    const byEmail = await list.POST(req("POST", { email: "newcomer@example.com" }), p);
    expect(byEmail.status).toBe(201);
    expect(await byEmail.json()).toMatchObject({ invitation: { label: null, email: "newcomer@example.com", role: "viewer" } });
    for (const body of [{}, { role: "viewer" }, { email: "a@example.com", label: "A" }, { label: "   " }, { label: "x".repeat(81) }, { label: "A", extra: true }]) {
      expect((await list.POST(req("POST", body), p)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await listInvitations(db(), owner, tripId, NOW)).toHaveLength(2);
  });

  it("renew a link entry through its own route", async () => {
    session.actor = owner;
    const first = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const res = await renewRoute.POST(req("POST"), ctx({ tripId, invitationId: first.invitationId }));
    expect(res.status).toBe(201);
    const renewed = (await res.json()) as { invitationUrl: string; invitation: { label: string } };
    expect(renewed.invitation.label).toBe("Mei");
    expect(renewed.invitationUrl).not.toBe(first.invitationUrl);
    session.actor = null;
    expect((await renewRoute.POST(req("POST"), ctx({ tripId, invitationId: first.invitationId }))).status).toBe(401);
  });
});

describe("the sign-in gate and an invitation by link", () => {
  const attempt = (over: Record<string, unknown> = {}) => ({ provider: "google", providerAccountId: "sub-new", email: "new@example.com", emailVerified: true, ...over });

  it("admits a new Google account that arrives with an unused link, but not without it", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const hash = await stageInvitation(db(), tokenOf(link.invitationUrl), NOW);
    expect(await allowSignIn(db(), attempt(), NOW)).toBe(false);
    expect(await allowSignIn(db(), attempt({ stagedHash: hash }), NOW)).toBe(true);
  });

  it("still needs a verified email, so an unverified address can never become the account's email", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const stagedHash = await stageInvitation(db(), tokenOf(link.invitationUrl), NOW);
    expect(await allowSignIn(db(), attempt({ stagedHash, emailVerified: false }), NOW)).toBe(false);
    expect(await allowSignIn(db(), attempt({ stagedHash, email: undefined }), NOW)).toBe(false);
  });

  it("doesn't admit anyone for a link that was used, revoked or has expired, or for an email invitation to someone else", async () => {
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", NOW);
    const hash = await stageInvitation(db(), tokenOf(link.invitationUrl), NOW);
    expect(await allowSignIn(db(), attempt({ stagedHash: hash }), later(8))).toBe(false); // expired
    await acceptInvitation(db(), mei, hash, NOW);
    expect(await allowSignIn(db(), attempt({ stagedHash: hash }), NOW)).toBe(false); // used
    const second = await createLinkInvitation(db(), owner, tripId, "Other", NOW);
    const secondHash = await stageInvitation(db(), tokenOf(second.invitationUrl), NOW);
    await revokeInvitation(db(), owner, tripId, second.invitationId, NOW);
    expect(await allowSignIn(db(), attempt({ stagedHash: secondHash }), NOW)).toBe(false); // revoked
    const byEmail = await createInvitation(db(), owner, tripId, "someone-else@example.com", NOW);
    const emailHash = await stageInvitation(db(), tokenOf(byEmail.invitationUrl), NOW);
    expect(await allowSignIn(db(), attempt({ stagedHash: emailHash }), NOW)).toBe(false); // meant for another address
    expect(await allowSignIn(db(), attempt({ stagedHash: Buffer.alloc(32, 1) }), NOW)).toBe(false); // matches nothing
  });
});
