import { describe, expect, it } from "vitest";
import {
  clearStageCookie,
  hashInvitationToken,
  invitationStatus,
  isInvitationToken,
  newInvitationToken,
  stageCookie,
  stagedHash,
} from "@/server/modules/invitations/invitations.rules";

describe("invitation tokens", () => {
  it("are 43 base64url characters and differ every time", () => {
    const a = newInvitationToken();
    expect(isInvitationToken(a)).toBe(true);
    expect(a).not.toBe(newInvitationToken());
    expect(isInvitationToken(`${a}x`)).toBe(false);
    expect(isInvitationToken("a+b/".padEnd(43, "a"))).toBe(false);
  });

  it("hash to 32 bytes", () => {
    expect(hashInvitationToken("x".repeat(43))).toHaveLength(32);
  });
});

describe("invitation status", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("derives expired from a pending invitation whose expiry has passed", () => {
    expect(invitationStatus({ status: "pending", expires_at: new Date("2026-09-26T12:00:01Z") }, now)).toBe("pending");
    expect(invitationStatus({ status: "pending", expires_at: now }, now)).toBe("expired");
    expect(invitationStatus({ status: "accepted", expires_at: new Date("2020-01-01") }, now)).toBe("accepted");
    expect(invitationStatus({ status: "revoked", expires_at: null }, now)).toBe("revoked");
  });
});

describe("staging cookie", () => {
  const hash = hashInvitationToken("t".repeat(43));
  it("uses a __Host- Secure cookie over HTTPS and a plain one on http://localhost", () => {
    expect(stageCookie("https://fieldnotes.example", hash)).toBe(`__Host-fieldnotes-invite=${hash.toString("hex")}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax; Secure`);
    expect(stageCookie("http://localhost:3000", hash)).toBe(`fieldnotes-invite=${hash.toString("hex")}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax`);
    expect(clearStageCookie("https://fieldnotes.example")).toContain("Max-Age=0");
  });

  it("reads back only a well-formed hash under the right name", () => {
    const hex = hash.toString("hex");
    expect(stagedHash("http://localhost:3000", `a=1; fieldnotes-invite=${hex}`)).toEqual(hash);
    expect(stagedHash("https://fieldnotes.example", `fieldnotes-invite=${hex}`)).toBeNull();
    expect(stagedHash("http://localhost:3000", "fieldnotes-invite=zz")).toBeNull();
    expect(stagedHash("http://localhost:3000", null)).toBeNull();
  });
});
