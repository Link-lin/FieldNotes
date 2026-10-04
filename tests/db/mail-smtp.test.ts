import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { createTrip } from "@/server/modules/trips/trips.service";
import { createInvitation } from "@/server/modules/invitations/invitations.service";
import { mailConfigured, sendMail } from "@/server/core/mail";
import type { Actor } from "@/server/auth/actor";

/** A minimal SMTP server that accepts every message and keeps what it received. No TLS, no login. */
function smtpSink(): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 queued\r\n");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") socket.write("250-sink\r\n250 8BITMIME\r\n");
        else if (command === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (command === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        messages,
        close: () => new Promise<void>((done) => { sockets.forEach((s) => s.destroy()); server.close(() => done()); }),
      }),
    ),
  );
}

/** Undo quoted-printable line folding and escapes, so a message body can be searched as text. */
const decode = (raw: string) => raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
/** A header's value as a mail client shows it: folded lines joined and RFC 2047 encoded words decoded. */
const header = (raw: string, name: string) => {
  const unfolded = raw.split("\r\n\r\n")[0]!.replace(/\r\n[ \t]+/g, " ");
  const value = new RegExp(`^${name}: (.*)$`, "im").exec(unfolded)?.[1];
  return value?.replace(/=\?UTF-8\?Q\?(.*?)\?=\s*/gi, (_, q: string) => decode(q.replace(/_/g, " ")));
};

/** One MIME part of a multipart message (for example "text/html"), decoded. */
const part = (raw: string, type: string) => {
  const boundary = /boundary="?([^"\r\n;]+)"?/i.exec(raw)?.[1];
  const found = raw.split(`--${boundary}`).find((p) => new RegExp(`Content-Type: ${type}`, "i").test(p));
  return found ? decode(found.split("\r\n\r\n").slice(1).join("\r\n\r\n")) : "";
};

let owner: Actor, tripId: string;
let sink: Awaited<ReturnType<typeof smtpSink>>;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link Lin");
  tripId = (await createTrip(testDb(), owner, { ...tripInput, title: 'Hawaii <b>& "friends"' }, NOW)).id;
  sink = await smtpSink();
  vi.stubEnv("SMTP_URL", `smtp://127.0.0.1:${sink.port}`);
  vi.stubEnv("MAIL_FROM", "Field Notes <notes@example.com>");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await sink.close();
});

describe("sending over SMTP", () => {
  it("is on only when both the server and the sender are set", () => {
    expect(mailConfigured()).toBe(true);
    vi.stubEnv("MAIL_FROM", "");
    expect(mailConfigured()).toBe(false);
    vi.stubEnv("MAIL_FROM", "Field Notes <notes@example.com>");
    vi.stubEnv("SMTP_URL", "  ");
    expect(mailConfigured()).toBe(false);
    return expect(sendMail({ to: "a@example.com", subject: "x", text: "x", html: "x" })).rejects.toThrow("not configured");
  });

  it("delivers a real invitation: sender, recipient, reply-to, subject, text and escaped HTML parts", async () => {
    const link = await createInvitation(testDb(), owner, tripId, "newcomer@example.com", NOW, "editor");
    expect(link.delivery).toBe("sent");
    expect(sink.messages).toHaveLength(1);
    const raw = sink.messages[0]!;
    expect(header(raw, "From")).toContain("notes@example.com");
    expect(header(raw, "To")).toContain("newcomer@example.com");
    expect(header(raw, "Reply-To")).toContain("owner@example.com");
    expect(header(raw, "Subject")).toContain("Link Lin shared");
    expect(raw).toMatch(/Content-Type: multipart\/alternative/i);
    const text = part(raw, "text/plain");
    const html = part(raw, "text/html");
    for (const body of [text, html]) {
      expect(body).toContain(link.invitationUrl); // the working link is in both parts
      expect(body).toContain("change its events, bookings and notes");
    }
    // The title's markup is literal text in the plain part and escaped in the HTML part.
    expect(text).toContain('Hawaii <b>& "friends"');
    expect(html).toContain("Hawaii &lt;b&gt;&amp; &quot;friends&quot;");
    expect(html).not.toContain("<b>& ");
  });

  it("cannot be made to add a recipient or header through the trip title or the owner's name", async () => {
    await testDb().updateTable("User").set({ name: "Link\r\nBcc: attacker@evil.example" }).where("id", "=", owner.userId).execute();
    await testDb().updateTable("trips").set({ title: "Trip\nBcc: attacker@evil.example" }).where("id", "=", tripId).execute();
    await createInvitation(testDb(), owner, tripId, "newcomer@example.com", NOW);
    const head = sink.messages[0]!.split("\r\n\r\n")[0]!;
    expect(head).not.toMatch(/^Bcc:/im);
    expect(header(head, "To")).toBe("newcomer@example.com");
    expect(head).not.toContain("attacker@evil.example\r\n");
  });

  it("fails quickly and quietly, keeping the invitation, when the mail server is unreachable", async () => {
    await sink.close();
    vi.stubEnv("SMTP_URL", "smtp://127.0.0.1:1"); // nothing listens here
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const started = Date.now();
      const link = await createInvitation(testDb(), owner, tripId, "newcomer@example.com", NOW);
      expect(link.delivery).toBe("failed");
      expect(Date.now() - started).toBeLessThan(8000);
      expect(link.invitationUrl).toMatch(/\/invite#/); // still there to copy
      const output = logged.mock.calls.flat().join(" ");
      expect(output).toMatch(/\[mail\] Error ECONNECTION|\[mail\] Error ESOCKET/);
      expect(output).not.toContain("newcomer@example.com");
    } finally {
      logged.mockRestore();
    }
    sink = await smtpSink(); // so afterEach has something to close
  });
});
