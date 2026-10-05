import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip } from "@/server/modules/trips/trips.service";
import { createInvitation, EMAIL_COOLDOWN_MS, listInvitations, revokeInvitation, stageInvitation, updateInvitationRole } from "@/server/modules/invitations/invitations.service";
import { HttpError } from "@/server/core/http/errors";
import type { Actor } from "@/server/auth/actor";

// Email is switched on and off per test; every send is recorded or made to fail.
const mail = vi.hoisted(() => ({ on: true, fail: null as Error | null, sent: [] as Array<Record<string, string | undefined>> }));
vi.mock("@/server/core/mail", () => ({
  mailConfigured: () => mail.on,
  sendMail: async (message: Record<string, string | undefined>) => {
    if (mail.fail) throw mail.fail;
    mail.sent.push(message);
  },
}));

const db = () => testDb();
const tokenOf = (url: string) => url.split("#")[1]!;
async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
}

let owner: Actor, viewer: Actor, tripId: string;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link Lin");
  viewer = await makeActor("viewer@example.com", "Sam");
  tripId = (await createTrip(db(), owner, { ...tripInput, title: "Hawaii & friends" }, NOW)).id;
  Object.assign(mail, { on: true, fail: null, sent: [] });
});

describe("emailing invitations", () => {
  it("emails the invitation once it is created, with the role, the owner as reply-to, and the link", async () => {
    const link = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW, "editor");
    expect(link.delivery).toBe("sent");
    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0]!;
    expect(sent).toMatchObject({ to: "newcomer@example.com", replyTo: "owner@example.com" });
    expect(sent.subject).toBe("Link Lin shared \u201cHawaii & friends\u201d with you on Field Notes");
    expect(sent.text).toContain(link.invitationUrl);
    expect(sent.text).toContain("change its events, bookings and notes");
    expect(sent.html).toContain("Hawaii &amp; friends");
    // The link in the email is the one that works, and it is still returned to the owner.
    await stageInvitation(db(), tokenOf(link.invitationUrl), NOW);
  });

  it("falls back to the owner's email when they have no name", async () => {
    await db().updateTable("User").set({ name: null }).where("id", "=", owner.userId).execute();
    await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW);
    expect(mail.sent[0]!.subject).toBe("owner@example.com shared \u201cHawaii & friends\u201d with you on Field Notes");
  });

  it("sends nothing when email isn't set up, and the owner copies the link as before", async () => {
    mail.on = false;
    const link = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW);
    expect(link.delivery).toBe("off");
    expect(mail.sent).toEqual([]);
    expect(link.invitationUrl).toMatch(/\/invite#/);
  });

  it("reports a refused send without failing the request, keeps the invitation and logs no address", async () => {
    mail.fail = Object.assign(new Error("550 5.1.1 <newcomer@example.com> user unknown"), { code: "EENVELOPE" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const link = await createInvitation(db(), owner, tripId, "newcomer@example.com", NOW);
      expect(link.delivery).toBe("failed");
      expect(await listInvitations(db(), owner, tripId, NOW)).toHaveLength(1);
      await stageInvitation(db(), tokenOf(link.invitationUrl), NOW); // the link still works, to copy
      const output = logged.mock.calls.flat().join(" ");
      expect(output).toContain("[mail] Error EENVELOPE");
      expect(output).not.toContain("newcomer@example.com");
      expect(output).not.toContain("user unknown");
    } finally {
      logged.mockRestore();
    }
  });

  it("sends nothing when the request is refused", async () => {
    await expectHttp(createInvitation(db(), viewer, tripId, "friend@example.com", NOW), 404); // not a member at all
    await expectHttp(createInvitation(db(), owner, tripId, "owner@example.com", NOW), 422); // their own address
    expect(mail.sent).toEqual([]);
  });

  it("refuses a second link for a pending person within a minute, so the emailed link keeps working", async () => {
    const t0 = new Date();
    const first = await createInvitation(db(), owner, tripId, "newcomer@example.com", t0);
    await expectHttp(createInvitation(db(), owner, tripId, "newcomer@example.com", new Date(t0.getTime() + 1000)), 429, "invitation_recent");
    expect(mail.sent).toHaveLength(1);
    await stageInvitation(db(), tokenOf(first.invitationUrl), t0); // untouched: the emailed link still works
    // Changing what they can do needs no new link, so it isn't held up.
    await updateInvitationRole(db(), owner, tripId, first.invitationId, "owner", new Date(t0.getTime() + 2000));
    // After the minute a new link goes out, and the earlier one stops working.
    const later = new Date(t0.getTime() + EMAIL_COOLDOWN_MS + 1000);
    const second = await createInvitation(db(), owner, tripId, "newcomer@example.com", later, "owner"); // "Send new link" passes the entry's role
    expect(second.delivery).toBe("sent");
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]!.text).toContain("share it and delete it"); // the role changed in between
    await expectHttp(stageInvitation(db(), tokenOf(first.invitationUrl), later), 404);
  });

  it("applies the minute only while email is on, and not to a revoked entry", async () => {
    mail.on = false;
    const t0 = new Date();
    await createInvitation(db(), owner, tripId, "newcomer@example.com", t0);
    await createInvitation(db(), owner, tripId, "newcomer@example.com", new Date(t0.getTime() + 1000)); // email off: no limit
    mail.on = true;
    const entry = (await listInvitations(db(), owner, tripId, t0))[0]!;
    await revokeInvitation(db(), owner, tripId, entry.id, new Date(t0.getTime() + 2000));
    const again = await createInvitation(db(), owner, tripId, "newcomer@example.com", new Date(t0.getTime() + 3000));
    expect(again.delivery).toBe("sent");
  });
});
