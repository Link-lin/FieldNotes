import { beforeEach, describe, expect, it, vi } from "vitest";
import { event, makeActor, makeActorWithoutEmail, NOW, reset, testDb, tripInput } from "./helpers";
import type { Actor } from "@/server/auth/actor";
import { HttpError } from "@/server/core/http/errors";
import { deleteAccount } from "@/server/modules/account/account.service";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { acceptInvitation, createInvitation, stageInvitation } from "@/server/modules/invitations/invitations.service";
import { createItem } from "@/server/modules/items/items.service";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";

const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, string | undefined>> }));
vi.mock("@/server/core/mail", () => ({
  mailConfigured: () => true,
  sendMail: async (message: Record<string, string | undefined>) => {
    mail.sent.push(message);
  },
}));

const db = () => testDb();
async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

// Until invitations can be sent as a link, an account without an email gets its role through a direct grant.
async function giveRole(tripId: string, who: Actor, role: "viewer" | "editor" | "owner") {
  await db()
    .insertInto("trip_viewers")
    .values({ trip_id: tripId, invitee_email_normalized: `grant-${role}@example.com`, viewer_user_id: who.userId, role, status: "accepted", invitation_token_hash: Buffer.from(crypto.randomUUID()), expires_at: new Date(NOW.getTime() + 864e5), accepted_at: NOW })
    .execute();
}

let owner: Actor, mei: Actor, tripId: string;
beforeEach(async () => {
  await reset();
  mail.sent = [];
  owner = await makeActor("owner@example.com", "Link Lin");
  mei = await makeActorWithoutEmail("Mei");
  tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
});

describe("an account without an email address", () => {
  it("is built without an email and is never on the owner allowlist", () => {
    expect(mei).toEqual({ userId: expect.any(String), email: null, isOwner: false });
  });

  it("can't create trips, whatever it is allowed to do on others", async () => {
    await giveRole(tripId, mei, "owner");
    await expectHttp(createTrip(db(), mei, tripInput, NOW), 403);
  });

  it("sees and changes a trip by its role, like anyone else", async () => {
    await createItem(db(), owner, tripId, event());
    await giveRole(tripId, mei, "viewer");
    expect((await getTripDetail(db(), mei, tripId, NOW)).trip).toMatchObject({ role: "viewer", ownerName: "Link Lin" });
    expect((await getDashboard(db(), mei, NOW)).trips.map((t) => t.id)).toEqual([tripId]);
    await expectHttp(createItem(db(), mei, tripId, event()), 403);
    await db().updateTable("trip_viewers").set({ role: "editor" }).where("trip_id", "=", tripId).execute();
    await createItem(db(), mei, tripId, event({ title: "Added by Mei" }));
    expect((await getTripDetail(db(), mei, tripId, NOW)).items).toHaveLength(2);
  });

  it("can't accept an email invitation, even holding the link", async () => {
    const link = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW);
    const hash = await stageInvitation(db(), link.invitationUrl.split("#")[1]!, NOW);
    await expectHttp(acceptInvitation(db(), mei, hash, NOW), 403, "invitation_wrong_account");
  });

  it("can invite people once it is an owner: the email names it, or says Someone, and has no reply-to", async () => {
    await giveRole(tripId, mei, "owner");
    await createInvitation(db(), mei, tripId, "newcomer@example.com", NOW);
    expect(mail.sent[0]).toMatchObject({ to: "newcomer@example.com", replyTo: undefined });
    expect(mail.sent[0]!.subject).toBe(`Mei shared "${tripInput.title}" with you on Field Notes`);
    await db().updateTable("User").set({ name: null }).where("id", "=", mei.userId).execute();
    await createInvitation(db(), mei, tripId, "other@example.com", NOW);
    expect(mail.sent[1]!.subject).toBe(`Someone shared "${tripInput.title}" with you on Field Notes`);
  });

  it("can delete its account, which only removes its own grants", async () => {
    await giveRole(tripId, mei, "editor");
    await deleteAccount(db(), mei);
    expect(await db().selectFrom("User").select("id").where("id", "=", mei.userId).executeTakeFirst()).toBeUndefined();
    expect((await getTripDetail(db(), owner, tripId, NOW)).trip.id).toBe(tripId);
  });
});
