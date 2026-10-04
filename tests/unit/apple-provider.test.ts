import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appleClientSecret, appleConfig, appleEnabled, appleName, appleOrigin, applePrivateKey, appleProvider, cachedAppleClientSecret } from "@/server/auth/apple";
import { appleReturn } from "@/server/auth/apple-return";
import { verifiedEmail } from "@/server/auth/identity";

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = ec.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pemBody = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const rsaPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const p384Pem = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const SETTINGS = { servicesId: "com.example.notes.web", teamId: "TEAMID1234", keyId: "KEYID12345", privateKey: pem };
const env = (vars: Record<string, string>) => {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
};
const configured = () => env({ AUTH_APPLE_ID: SETTINGS.servicesId, AUTH_APPLE_TEAM_ID: SETTINGS.teamId, AUTH_APPLE_KEY_ID: SETTINGS.keyId, AUTH_APPLE_PRIVATE_KEY: pem });

beforeEach(() => {
  env({ AUTH_APPLE_ID: "", AUTH_APPLE_TEAM_ID: "", AUTH_APPLE_KEY_ID: "", AUTH_APPLE_PRIVATE_KEY: "", APPLE_ORIGIN: "" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Apple configuration", () => {
  it("is off unless the Services ID, team, key ID and key are all set", () => {
    expect(appleConfig()).toBeNull();
    expect(appleEnabled()).toBe(false);
    env({ AUTH_APPLE_ID: SETTINGS.servicesId, AUTH_APPLE_TEAM_ID: SETTINGS.teamId, AUTH_APPLE_KEY_ID: SETTINGS.keyId });
    expect(appleConfig()).toBeNull();
    env({ AUTH_APPLE_PRIVATE_KEY: `  ${pem}  ` });
    expect(appleConfig()).toEqual({ ...SETTINGS, privateKey: pem.trim() });
    expect(appleEnabled()).toBe(true);
  });

  it("uses Apple's own host unless a test points it elsewhere", () => {
    expect(appleOrigin()).toBe("https://appleid.apple.com");
    env({ APPLE_ORIGIN: "http://localhost:4020/" });
    expect(appleOrigin()).toBe("http://localhost:4020");
  });

  it("refuses to build a provider without credentials", () => {
    expect(() => appleProvider()).toThrow("not configured");
  });
});

describe("the signing key", () => {
  it("reads the .p8 PEM, with its line breaks written \\n, in quotes, or as just the base64 body", () => {
    const sign = (key: ReturnType<typeof applePrivateKey>) => key.export({ type: "pkcs8", format: "pem" });
    const expected = sign(applePrivateKey(pem));
    expect(sign(applePrivateKey(pem.trim().replace(/\n/g, "\\n")))).toBe(expected);
    expect(sign(applePrivateKey(`"${pem.trim().replace(/\n/g, "\\n")}"`))).toBe(expected);
    expect(sign(applePrivateKey(`'${pem.trim()}'`))).toBe(expected);
    expect(sign(applePrivateKey(pemBody))).toBe(expected);
    expect(sign(applePrivateKey(pemBody.replace(/(.{40})/g, "$1\n")))).toBe(expected);
  });

  it("refuses anything that isn't the P-256 key Apple issues, without echoing it", () => {
    expect(() => applePrivateKey("not a key")).toThrow("not a key Node can read");
    expect(() => applePrivateKey("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")).toThrow("not a key Node can read");
    expect(() => applePrivateKey(rsaPem)).toThrow("not a P-256 key");
    expect(() => applePrivateKey(p384Pem)).toThrow("not a P-256 key");
    for (const [bad, secret] of [["SECRETKEYMATERIAL-0123456789-abcdef", "SECRETKEYMATERIAL"], [rsaPem, rsaPem.split("\n")[1]!]] as const) {
      expect(() => applePrivateKey(bad)).toThrow();
      try {
        applePrivateKey(bad);
      } catch (err) {
        expect(String(err)).not.toContain(secret);
      }
    }
  });
});

describe("the client secret", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const parts = (secret: string) => {
    const [h, c, s] = secret.split(".") as [string, string, string];
    return { h, c, s, header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(c, "base64url").toString()) };
  };

  it("is an ES256 token Apple can verify: the key's ID, the team, the Services ID, Apple as audience, an hour of life", () => {
    const { h, c, s, header, claims } = parts(appleClientSecret(SETTINGS, now));
    expect(header).toEqual({ alg: "ES256", kid: "KEYID12345", typ: "JWT" });
    const iat = Math.floor(now.getTime() / 1000) - 60; // a little in the past, for a clock slightly ahead of Apple's
    expect(claims).toEqual({ iss: "TEAMID1234", sub: "com.example.notes.web", aud: "https://appleid.apple.com", iat, exp: iat + 3600 });
    expect(claims.exp - iat).toBeLessThan(15777000); // Apple's six-month ceiling
    const raw = Buffer.from(s, "base64url");
    expect(raw).toHaveLength(64); // r and s, not DER
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, raw)).toBe(true);
    expect(verify("sha256", Buffer.from(`${h}.${c}x`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, raw)).toBe(false);
  });

  it("names whatever host the test points Apple at as its audience", () => {
    env({ APPLE_ORIGIN: "http://localhost:4020" });
    expect(parts(appleClientSecret(SETTINGS, now)).claims.aud).toBe("http://localhost:4020");
  });

  it("is signed once and reused for half an hour, then again, and again when the credentials change", () => {
    const first = cachedAppleClientSecret(SETTINGS, now);
    expect(cachedAppleClientSecret(SETTINGS, new Date(now.getTime() + 29 * 60_000))).toBe(first);
    const later = cachedAppleClientSecret(SETTINGS, new Date(now.getTime() + 31 * 60_000));
    expect(later).not.toBe(first);
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(cachedAppleClientSecret({ ...SETTINGS, privateKey: other }, new Date(now.getTime() + 31 * 60_000))).not.toBe(later);
    expect(cachedAppleClientSecret({ ...SETTINGS, keyId: "OTHERKEY12" }, new Date(now.getTime() + 31 * 60_000))).not.toBe(later);
  });
});

describe("whether Sign in with Apple is on", () => {
  it("says nothing when none of the four settings is present, and names the missing ones when only some are", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(appleEnabled()).toBe(false);
    expect(log).not.toHaveBeenCalled();
    env({ AUTH_APPLE_ID: SETTINGS.servicesId, AUTH_APPLE_PRIVATE_KEY: pem });
    expect(appleEnabled()).toBe(false);
    expect(appleEnabled()).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    const said = String(log.mock.calls[0]![0]);
    expect(said).toContain("missing AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID");
    expect(said).not.toContain("AUTH_APPLE_ID,");
    expect(said).not.toContain("BEGIN");
    expect(said).not.toContain(SETTINGS.servicesId);
  });

  it("stays off, and says why once, when the key can't sign", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    configured();
    env({ AUTH_APPLE_PRIVATE_KEY: rsaPem });
    expect(appleEnabled()).toBe(false);
    expect(appleEnabled()).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain("Sign in with Apple is switched off");
    expect(String(log.mock.calls[0]![0])).toContain("not a P-256 key");
    expect(String(log.mock.calls[0]![0])).not.toContain("BEGIN");
  });
});

describe("the Apple provider", () => {
  const provider = () => {
    configured();
    return appleProvider();
  };
  type Profile = (claims: Record<string, unknown>, tokens: unknown) => Promise<unknown> | unknown;

  it("is Auth.js's Apple provider with the app's Services ID, a signed client secret and no stored tokens", async () => {
    const p = provider();
    expect(p).toMatchObject({ id: "apple", name: "Apple", type: "oidc", checks: ["nonce", "state"] });
    expect((p.authorization as { params: Record<string, string> }).params).toEqual({ scope: "name email", response_mode: "form_post" });
    const options = p.options as { clientId: string; clientSecret: string; issuer: string; account: () => unknown };
    expect(options.clientId).toBe("com.example.notes.web");
    expect(options.issuer).toBe("https://appleid.apple.com");
    expect(options.clientSecret.split(".")).toHaveLength(3);
    expect(options.account()).toEqual({}); // neither Apple's access, refresh nor ID token is kept
  });

  it("gives the account Apple's subject, the name when sent, the address only when shared, and no avatar", async () => {
    const profile = (provider().options as { profile: Profile }).profile;
    const shared = { sub: "001.abc", email: "sam@example.com", email_verified: "true", is_private_email: "false" };
    expect(await profile({ ...shared, user: { name: { firstName: "Sam", lastName: "Lee" } } }, {})).toEqual({ id: "001.abc", name: "Sam Lee", email: "sam@example.com", image: null });
    expect(await profile(shared, {})).toEqual({ id: "001.abc", name: null, email: "sam@example.com", image: null });
    expect(await profile({ sub: "001.def", email: "x1y2@privaterelay.appleid.com", email_verified: "true", is_private_email: "true", user: { name: { firstName: "Mei" } } }, {})).toEqual({ id: "001.def", name: "Mei", email: null, image: null });
    expect(await profile({ ...shared, email_verified: "false" }, {})).toMatchObject({ email: null });
  });

  it("doesn't fail on a user field without a name, which Auth.js's own mapping would", async () => {
    const profile = (provider().options as { profile: Profile }).profile;
    expect(await profile({ sub: "001.abc", user: { email: "sam@example.com" } }, {})).toEqual({ id: "001.abc", name: null, email: null, image: null });
    expect(await profile({ sub: "001.abc", user: null }, {})).toMatchObject({ name: null });
  });
});

describe("the name Apple sends once", () => {
  it("joins the first and last name, in one line", () => {
    expect(appleName({ user: { name: { firstName: "Sam", lastName: "Lee" } } })).toBe("Sam Lee");
    expect(appleName({ user: { name: { firstName: "Mei" } } })).toBe("Mei");
    expect(appleName({ user: { name: { lastName: "Lee" } } })).toBe("Lee");
    expect(appleName({ user: { name: { firstName: "  Sam \n", lastName: "  Lee " } } })).toBe("Sam Lee");
  });

  it("is null when nothing usable came", () => {
    expect(appleName({})).toBeNull();
    expect(appleName({ user: null })).toBeNull();
    expect(appleName({ user: {} })).toBeNull();
    expect(appleName({ user: { name: { firstName: "", lastName: "  " } } })).toBeNull();
    expect(appleName({ user: { name: { firstName: 5, lastName: { a: 1 } } } })).toBeNull();
  });

  it("drops control and direction-changing characters, and stops at 80 characters", () => {
    expect(appleName({ user: { name: { firstName: "Sam\u0000\u0007", lastName: "\u202ELee\u202C" } } })).toBe("Sam Lee");
    expect(appleName({ user: { name: { firstName: "a".repeat(200) } } })).toHaveLength(80);
  });
});

describe("the address a sign-in vouches for", () => {
  it.each([
    ["google", { email: "a@x.com", email_verified: true }, "a@x.com"],
    ["google", { email: "a@x.com", email_verified: "true" }, null],
    ["google", { email: "a@x.com", email_verified: false }, null],
    ["google", { email: "a@x.com" }, null],
    ["google", { email: "   ", email_verified: true }, null],
    ["google", { email: 5, email_verified: true }, null],
    ["apple", { email: "a@x.com", email_verified: "true", is_private_email: "false" }, "a@x.com"],
    ["apple", { email: "a@x.com", email_verified: true, is_private_email: false }, "a@x.com"],
    ["apple", { email: "a@x.com", email_verified: true }, "a@x.com"],
    ["apple", { email: "a@x.com", email_verified: "false" }, null],
    ["apple", { email: "a@x.com" }, null],
    ["apple", { email: "a@x.com", email_verified: "true", is_private_email: "true" }, null],
    ["apple", { email: "a@x.com", email_verified: true, is_private_email: true }, null],
    ["apple", { email: "x1y2@privaterelay.appleid.com", email_verified: "true", is_private_email: "false" }, null],
    ["apple", { email: " X1Y2@PrivateRelay.AppleID.com ", email_verified: true }, null],
    ["wechat", { email: "a@x.com", email_verified: true }, null],
    [undefined, { email: "a@x.com", email_verified: true }, null],
  ])("%s %j gives %j", (provider, claims, expected) => {
    expect(verifiedEmail(provider, claims)).toBe(expected);
  });
});

describe("the page that carries Apple's callback back to the app", () => {
  const CALLBACK = "https://notes.example.com/api/auth/callback/apple";
  const post = (url: string, body: BodyInit) => new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

  it("answers Apple's POST with a page that posts the same fields straight back, marked, under the CSP nonce", async () => {
    const user = JSON.stringify({ name: { firstName: "Sam", lastName: "Lee" } });
    const res = await appleReturn(post(CALLBACK, new URLSearchParams({ code: "c1", state: "s1", id_token: "a.b.c", user })), "n0nce");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res?.headers.get("cache-control")).toBe("private, no-store");
    const html = await res!.text();
    expect(html).toContain('<form method="post" action="/api/auth/callback/apple?bounce=1">');
    expect(html).toContain('<input type="hidden" name="code" value="c1">');
    expect(html).toContain('<input type="hidden" name="state" value="s1">');
    expect(html).toContain('<input type="hidden" name="id_token" value="a.b.c">');
    expect(html).toContain(`<input type="hidden" name="user" value="${user.replace(/"/g, "&quot;")}">`);
    expect(html).toContain('<script nonce="n0nce">document.forms[0].submit()</script>');
    expect(html).toContain('<style nonce="n0nce">');
    expect(html).toContain("<button"); // a way on for a browser that won't run the script
    expect(html).not.toMatch(/<script(?![^>]*nonce)/); // no script without the nonce
  });

  it("escapes whatever it is given, names and values alike", async () => {
    const res = await appleReturn(post(CALLBACK, new URLSearchParams({ 'a"b': `"><img src=x onerror=alert(1)>&'` })), "n0nce");
    const html = await res!.text();
    expect(html).not.toContain("<img");
    expect(html).toContain('name="a&quot;b" value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;&#39;"');
  });

  it("works without a nonce, leaving the script for the CSP to refuse and the button for the person", async () => {
    const html = await (await appleReturn(post(CALLBACK, "code=c1&state=s1"), null))!.text();
    expect(html).toContain("<script>document.forms[0].submit()</script>");
    expect(html).toContain("<button");
  });

  it("leaves everything else to Auth.js, without reading the body", async () => {
    const marked = post(`${CALLBACK}?bounce=1`, "code=c1&state=s1");
    expect(await appleReturn(marked, "n")).toBeNull();
    expect(marked.bodyUsed).toBe(false);
    expect(await appleReturn(new Request(CALLBACK), "n")).toBeNull(); // a GET
    expect(await appleReturn(post("https://notes.example.com/api/auth/callback/google", "code=c1"), "n")).toBeNull();
    expect(await appleReturn(post("https://notes.example.com/api/auth/signin/apple", "csrfToken=x"), "n")).toBeNull();
    expect(await appleReturn(post("https://notes.example.com/api/auth/callback/apple/extra", "code=c1"), "n")).toBeNull();
  });

  it("refuses a body far larger than anything Apple sends", async () => {
    const big = await appleReturn(post(CALLBACK, `code=${"a".repeat(20_000)}`), "n");
    expect(big?.status).toBe(413);
    const declared = { method: "POST", url: CALLBACK, headers: new Headers({ "content-length": "99999" }), text: async () => "" } as unknown as Request;
    expect((await appleReturn(declared, "n"))?.status).toBe(413);
  });

  it("stops reading a body that never says how long it is, once it is too long", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode("a".repeat(4096)));
        if (pulled >= 50) controller.close();
      },
    });
    const request = new Request(CALLBACK, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: stream, duplex: "half" } as RequestInit);
    expect((await appleReturn(request, "n"))?.status).toBe(413);
    expect(pulled).toBeLessThan(10); // 16 KB is four chunks; it didn't read all fifty
  });
});
