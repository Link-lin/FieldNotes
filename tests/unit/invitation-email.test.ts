import { describe, expect, it } from "vitest";
import { invitationEmail, type InvitationEmailInput } from "@/server/modules/invitations/invitations.email";

const input: InvitationEmailInput = {
  tripTitle: "Hawaii test trip",
  inviterName: "Link Lin",
  inviteeEmail: "sam@example.com",
  role: "editor",
  url: "https://notes.example.com/invite#abc_DEF-123",
  expiresAt: new Date("2026-10-11T08:30:00Z"),
};

describe("invitation email", () => {
  it("names the inviter, the trip, what the role allows, the link and the expiry date", () => {
    const mail = invitationEmail(input);
    expect(mail.subject).toBe("Link Lin shared \u201cHawaii test trip\u201d with you on Field Notes");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Link Lin");
      expect(part).toContain("Hawaii test trip");
      expect(part).toContain("change its events, bookings and notes");
      expect(part).toContain("sam@example.com");
      expect(part).toContain("https://notes.example.com/invite#abc_DEF-123");
      expect(part).toContain("11 Oct 2026 (UTC)"); // the recipient's zone is unknown, so the date says which zone it is in
    }
    expect(mail.text).toContain("you can ignore this email");
  });

  it("says what each role allows", () => {
    expect(invitationEmail({ ...input, role: "viewer" }).text).toContain("view it but not change it");
    expect(invitationEmail({ ...input, role: "owner" }).text).toContain("share it and delete it");
  });

  it("escapes user text in the HTML part and adds no images or scripts", () => {
    const html = invitationEmail({ ...input, tripTitle: `<script>alert("x")</script> & "Co"`, inviterName: `Eve <eve@evil.example>` }).html;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Co&quot;");
    expect(html).toContain("Eve &lt;eve@evil.example&gt;");
    // The link is escaped inside its attribute too.
    expect(invitationEmail({ ...input, url: 'https://x.example/invite#a"b' }).html).toContain('href="https://x.example/invite#a&quot;b"');
  });

  it("loads nothing from anywhere: its only links are the invitation, with no images, style sheets or web fonts", () => {
    const html = invitationEmail(input).html;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    const links = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links)).toEqual(new Set([input.url]));
    for (const remote of ["<img", "<link", "@import", "url(", "src="]) expect(html).not.toContain(remote);
    // The role is named in the ticket as well as described in words.
    expect(html).toContain("Editor");
  });

  it("cannot be used to start a new header from the trip title or the name", () => {
    const mail = invitationEmail({ ...input, tripTitle: "Trip\r\nBcc: attacker@evil.example", inviterName: "Link\nSubject: spoofed" });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe("Link Subject: spoofed shared \u201cTrip Bcc: attacker@evil.example\u201d with you on Field Notes");
    expect(mail.text.split("\n")[0]).not.toMatch(/\r/);
  });
});
