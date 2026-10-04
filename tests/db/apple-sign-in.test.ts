import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Auth } from "@auth/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { actorFor } from "@/server/auth/actor";
import { appleReturn } from "@/server/auth/apple-return";
import { authConfig } from "@/server/auth/config";
import { stageCookieName } from "@/server/modules/invitations/invitations.rules";
import { acceptInvitation, createInvitation, createLinkInvitation, stageInvitation } from "@/server/modules/invitations/invitations.service";
import { createTrip, getTripDetail } from "@/server/modules/trips/trips.service";

/**
 * Signing in with Apple, end to end through Auth.js itself (discovery, its state and nonce, the token exchange with
 * the client secret the app signs, the ID token, the sign-in gate, account creation and the session) against a
 * stand-in for appleid.apple.com. Apple's callback is a cross-site POST, so a model of the browser withholds
 * `SameSite=Lax` cookies from it, as browsers do, and the app's return page carries it back. Only Apple is simulated;
 * what the stand-in checks of each request is what Apple documents.
 */

const APP = "https://notes.example.test";
const CLIENT_ID = "com.example.notes.web";
const TEAM_ID = "TEAMID1234";
const KEY_ID = "KEYID12345";
const NONCE = "csp-nonce-for-the-return-page";

const teamKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const idKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = teamKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

/** Someone at Apple's sign-in page. Apple's booleans arrive as the string "true" or as a boolean, so both are tried. */
type Person = {
  sub: string;
  email?: string;
  emailVerified?: boolean | string;
  relay?: boolean | string;
  /** The `user` field Apple posts with the code, the first time a person approves the app only. */
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
};

let apple: Server;
let origin = "";
const grants = new Map<string, { person: Person; nonce: string; used: boolean }>();
const seen: Array<{ method: string; path: string; form: Record<string, string>; secretError: string | null }> = [];

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** What Apple documents for the client secret: ES256, signed by the team's key, with these claims and a bounded life. */
function secretError(secret: string | undefined): string | null {
  const [h, c, s] = (secret ?? "").split(".");
  if (!h || !c || !s) return "not a JWT";
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  if (header.alg !== "ES256" || header.kid !== KEY_ID) return "header";
  if (!verify("sha256", Buffer.from(`${h}.${c}`), { key: teamKey.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))) return "signature";
  const now = Date.now() / 1000;
  if (claims.iss !== TEAM_ID || claims.sub !== CLIENT_ID || claims.aud !== origin) return "claims";
  if (claims.iat > now || claims.exp <= now || claims.exp - now > 15777000) return "lifetime";
  return null;
}

function idToken(person: Person, nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const claims = b64(
    JSON.stringify({
      iss: origin,
      aud: CLIENT_ID,
      sub: person.sub,
      iat: now,
      exp: now + 600,
      nonce,
      nonce_supported: true,
      ...(person.email ? { email: person.email, email_verified: person.emailVerified ?? "true", is_private_email: person.relay ?? "false" } : {}),
    }),
  );
  return `${header}.${claims}.${b64(sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), idKey.privateKey))}`;
}

function fakeApple(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, "http://stand-in");
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(res, {
      issuer: origin,
      authorization_endpoint: `${origin}/auth/authorize`,
      token_endpoint: `${origin}/auth/token`,
      jwks_uri: `${origin}/auth/keys`,
      response_types_supported: ["code"],
      subject_types_supported: ["pairwise"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    });
  }
  if (url.pathname === "/auth/keys") return json(res, { keys: [{ ...idKey.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] });
  if (url.pathname === "/auth/token" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
      const error = secretError(form.client_secret);
      seen.push({ method: "POST", path: url.pathname, form, secretError: error });
      const grant = grants.get(form.code ?? "");
      if (error || form.grant_type !== "authorization_code" || form.client_id !== CLIENT_ID || form.redirect_uri !== `${APP}/api/auth/callback/apple`) return json(res, { error: "invalid_client" }, 400);
      if (!grant || grant.used) return json(res, { error: "invalid_grant" }, 400);
      grant.used = true;
      return json(res, { access_token: "apple-access", token_type: "Bearer", expires_in: 3600, refresh_token: "apple-refresh", id_token: idToken(grant.person, grant.nonce) });
    });
    return;
  }
  res.statusCode = 404;
  res.end();
}

beforeAll(async () => {
  apple = createServer(fakeApple);
  await new Promise<void>((resolve) => apple.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(apple.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => apple.close(() => resolve())));

const db = () => testDb();

beforeEach(async () => {
  await reset();
  seen.length = 0;
  grants.clear();
  vi.stubEnv("AUTH_SECRET", "a-test-secret-for-the-sign-in-flow-only-0123456789");
  vi.stubEnv("AUTH_APPLE_ID", CLIENT_ID);
  vi.stubEnv("AUTH_APPLE_TEAM_ID", TEAM_ID);
  vi.stubEnv("AUTH_APPLE_KEY_ID", KEY_ID);
  vi.stubEnv("AUTH_APPLE_PRIVATE_KEY", pem);
  vi.stubEnv("APPLE_ORIGIN", origin);
  vi.stubEnv("AUTH_URL", APP);
  vi.stubEnv("APP_ORIGIN", APP);
});
afterEach(() => vi.unstubAllEnvs());

/** A browser's cookies. A cross-site POST (Apple's) carries only the `SameSite=None` ones; this site's own requests carry all. */
class Browser {
  private cookies = new Map<string, { value: string; sameSite: string }>();
  set(name: string, value: string, sameSite = "lax") {
    this.cookies.set(name, { value, sameSite });
  }
  cookie(from: "this-site" | "another-site"): string {
    return [...this.cookies].filter(([, c]) => from === "this-site" || c.sameSite === "none").map(([name, c]) => `${name}=${c.value}`).join("; ");
  }
  has(namePart: string): boolean {
    return [...this.cookies.keys()].some((name) => name.includes(namePart));
  }
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, { value, sameSite: attrs.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith("samesite="))?.slice(9) ?? "lax" });
    }
  }
}

/** Auth.js, configured as the app configures it, reading the cookies of the request it is handed as the app reads them. */
const handle = (request: Request, cookie: string) =>
  Auth(request, { ...authConfig(db(), async () => cookie || null), secret: process.env.AUTH_SECRET, trustHost: true, basePath: "/api/auth" });

/** What the app's route does with a POST: the return page for Apple's own, and Auth.js for the rest (see `route.ts`). */
const route = async (request: Request, cookie: string) => (await appleReturn(request, NONCE)) ?? handle(request, cookie);
const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type Result = { authorizeUrl: string; startCookies: string[]; location: string; status: number };
type Options = {
  /** Where the sign-in page sends the person afterwards. */
  callbackUrl?: string;
  /** Whether Apple posts its one-time `user` field with the code. */
  withUser?: boolean;
  /** Replace the posted fields (a tampered state, a bad code). */
  tamper?: (fields: Record<string, string>) => Record<string, string>;
  /** Skip the return page, as if Apple's POST went straight to Auth.js. */
  direct?: boolean;
};

/**
 * The whole dance: start at /signin/apple, "approve" at Apple (a `person`, or null for declining), Apple's page posts to
 * the callback from another site, the return page answers, the browser posts back from this site, Auth.js finishes.
 */
async function signInWithApple(browser: Browser, person: Person | null, options: Options = {}): Promise<Result> {
  const csrf = await handle(new Request(`${APP}/api/auth/csrf`, { headers: { cookie: browser.cookie("this-site") } }), browser.cookie("this-site"));
  browser.take(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const startCookie = browser.cookie("this-site");
  const start = await handle(
    new Request(`${APP}/api/auth/signin/apple`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: startCookie }, body: new URLSearchParams({ csrfToken, callbackUrl: options.callbackUrl ?? "/" }) }),
    startCookie,
  );
  browser.take(start);
  const authorizeUrl = start.headers.get("location")!;
  const asked = new URL(authorizeUrl);
  const code = person ? `code-${grants.size + 1}` : null;
  if (person && code) grants.set(code, { person, nonce: asked.searchParams.get("nonce")!, used: false });
  let posted: Record<string, string> = code
    ? { code, state: asked.searchParams.get("state")!, ...(options.withUser && person?.user ? { user: JSON.stringify(person.user) } : {}) }
    : { error: "user_cancelled_authorize", state: asked.searchParams.get("state")! };
  if (options.tamper) posted = options.tamper(posted);
  const base = { "content-type": "application/x-www-form-urlencoded" };

  // Apple's page posts to the app: a cross-site POST.
  const crossSite = browser.cookie("another-site");
  const callback = () => new Request(`${APP}/api/auth/callback/apple`, { method: "POST", headers: { ...base, cookie: crossSite }, body: new URLSearchParams(posted) });
  let finished: Response;
  if (options.direct) {
    finished = await handle(callback(), crossSite);
  } else {
    const page = await route(callback(), crossSite);
    expect(page.headers.get("content-type"), "the return page should answer Apple's POST").toContain("text/html");
    const html = await page.text();
    // The page submits its form straight back: this site's own request, with every cookie.
    const action = /<form method="post" action="([^"]+)"/.exec(html)![1]!;
    const fields = [...html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)].map((m) => [unescapeHtml(m[1]!), unescapeHtml(m[2]!)] as [string, string]);
    const sameSite = browser.cookie("this-site");
    finished = await route(new Request(new URL(action, APP), { method: "POST", headers: { ...base, cookie: sameSite }, body: new URLSearchParams(fields) }), sameSite);
    expect(finished.status, "the marked POST should go to Auth.js, not be bounced again").toBe(302);
  }
  browser.take(finished);
  return { authorizeUrl, startCookies: start.headers.getSetCookie(), location: finished.headers.get("location") ?? "", status: finished.status };
}

const accounts = () => db().selectFrom("Account").selectAll().execute();
const users = () => db().selectFrom("User").selectAll().execute();
const SESSION = "__Secure-authjs.session-token";

/** A trip with an invitation by link already opened (staged) by the visitor, the way /invite does before sign-in. */
async function stagedLink(browser: Browser, role: "viewer" | "editor" = "editor") {
  const owner = await makeActor("owner@example.com", "Link Lin");
  const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
  const link = await createLinkInvitation(db(), owner, tripId, "Sam, on his iPhone", new Date(), role);
  const hash = await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date());
  browser.set(stageCookieName(APP), hash.toString("hex"));
  return { owner, tripId, hash };
}

describe("sending someone to Apple", () => {
  it("builds Apple's authorization address from its discovery document, asking for the name and email by form post", async () => {
    const { authorizeUrl } = await signInWithApple(new Browser(), null);
    expect(authorizeUrl.startsWith(`${origin}/auth/authorize?`)).toBe(true);
    const asked = new URL(authorizeUrl);
    expect(asked.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(asked.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback/apple`);
    expect(asked.searchParams.get("response_type")).toBe("code");
    expect(asked.searchParams.get("response_mode")).toBe("form_post");
    expect(asked.searchParams.get("scope")).toBe("name email");
    expect(asked.searchParams.get("state")).toBeTruthy();
    expect(asked.searchParams.get("nonce")).toBeTruthy();
    expect(authorizeUrl).not.toContain("client_secret");
    expect(authorizeUrl).not.toContain(teamKey.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64").slice(0, 20)); // the key never goes through the browser
  });

  it("sets the state and nonce cookies so they come back with Apple's cross-site POST", async () => {
    const { startCookies } = await signInWithApple(new Browser(), null);
    for (const name of ["authjs.state", "authjs.nonce"]) {
      const line = startCookies.find((l) => l.includes(name))!;
      expect(line, name).toMatch(/SameSite=none/i);
      expect(line, name).toMatch(/Secure/i);
    }
    // The callback-URL cookie stays Lax, which is why Apple's POST doesn't carry it (see "the return page").
    expect(startCookies.find((l) => l.includes("authjs.callback-url"))).toMatch(/SameSite=lax/i);
  });
});

describe("the return page", () => {
  it("is what lets Auth.js see the invitation: sent straight to Auth.js, Apple's POST carries no staging cookie", async () => {
    const hidden: Person = { sub: "001.mei", email: "x1y2@privaterelay.appleid.com", relay: "true", user: { name: { firstName: "Mei", lastName: "Chen" } } };
    const direct = new Browser();
    await stagedLink(direct);
    expect((await signInWithApple(direct, hidden, { withUser: true, direct: true })).location).toContain("error=AccessDenied");
    expect(await accounts()).toEqual([]);

    await reset();
    const bounced = new Browser();
    await stagedLink(bounced, "viewer");
    expect((await signInWithApple(bounced, hidden, { withUser: true })).location).not.toContain("error=");
    expect(await accounts()).toHaveLength(1);
  });

  it("keeps where the person was going: the callback-URL cookie is Lax too", async () => {
    const browser = new Browser();
    await stagedLink(browser);
    const { location } = await signInWithApple(browser, { sub: "001.mei", email: "x@privaterelay.appleid.com", relay: true }, { callbackUrl: "/invite" });
    expect(location).toBe(`${APP}/invite`);
  });
});

describe("what the app sends Apple, and checks of Apple's answer", () => {
  it("exchanges the code with the client secret it signs, as Apple documents", async () => {
    await signInWithApple(new Browser(), { sub: "001.sam", email: "second-owner@example.com" });
    const token = seen.find((s) => s.path === "/auth/token")!;
    expect(token.secretError).toBeNull();
    expect(token.form).toMatchObject({ grant_type: "authorization_code", client_id: CLIENT_ID, redirect_uri: `${APP}/api/auth/callback/apple`, code: "code-1" });
    expect(token.form.client_secret!.split(".")).toHaveLength(3);
  });

  it("turns Apple's refusal of the secret or the code into the sign-in error page, with nothing created", async () => {
    vi.stubEnv("AUTH_APPLE_TEAM_ID", "WRONGTEAM1"); // a secret Apple would not accept
    const wrong = await signInWithApple(new Browser(), { sub: "001.sam", email: "second-owner@example.com" });
    expect(wrong.location).toContain("error=");
    expect(seen[0]!.secretError).toBe("claims");
    vi.stubEnv("AUTH_APPLE_TEAM_ID", TEAM_ID);
    const bad = await signInWithApple(new Browser(), { sub: "001.sam", email: "second-owner@example.com" }, { tamper: (f) => ({ ...f, code: "not-a-code" }) });
    expect(bad.location).toContain("error=");
    expect(await users()).toEqual([]);
  });

  it("answers a state that doesn't match, or a refusal at Apple, with the sign-in error page, not a session", async () => {
    const forged = new Browser();
    expect((await signInWithApple(forged, { sub: "001.sam", email: "second-owner@example.com" }, { tamper: (f) => ({ ...f, state: "forged" }) })).location).toContain("error=");
    expect(forged.has("session-token")).toBe(false);
    const declined = new Browser();
    expect((await signInWithApple(declined, null)).location).toContain("error=");
    expect(declined.has("session-token")).toBe(false);
    expect(await users()).toEqual([]);
  });
});

describe("the sign-in gate for Apple", () => {
  it("turns away a new Apple identity with no invitation, whether or not it shares an address, creating nothing", async () => {
    for (const person of [{ sub: "001.a" }, { sub: "001.b", email: "stranger@example.com" }, { sub: "001.c", email: "x@privaterelay.appleid.com", relay: "true" }] as Person[]) {
      const browser = new Browser();
      expect((await signInWithApple(browser, person)).location).toContain("error=AccessDenied");
      expect(browser.has("session-token")).toBe(false);
    }
    expect(await users()).toEqual([]);
    expect(await accounts()).toEqual([]);
  });

  it("admits a shared, verified address on the owner allowlist as an account with that email, the name Apple sent, and no tokens", async () => {
    const browser = new Browser();
    const person: Person = { sub: "001.sam", email: "Second-Owner@Example.com", emailVerified: "true", user: { name: { firstName: "Sam", lastName: "Owner" }, email: "ignored@example.com" } };
    const { location } = await signInWithApple(browser, person, { withUser: true, callbackUrl: "/" });
    expect(location).toBe(`${APP}/`);
    expect(browser.has("session-token")).toBe(true);
    const [user] = await users();
    expect(user).toMatchObject({ name: "Sam Owner", email: "second-owner@example.com", image: null }); // trimmed and lowercased, and never the address in the unsigned `user` field
    expect(actorFor({ id: user!.id, email: user!.email })).toMatchObject({ isOwner: true });
    expect(await accounts()).toEqual([expect.objectContaining({ provider: "apple", providerAccountId: "001.sam", userId: user!.id, access_token: null, refresh_token: null, id_token: null })]);
  });

  it("takes Apple's booleans as the string or as a boolean, and treats an address Apple didn't vouch for as none", async () => {
    for (const [i, verified] of ["true", true].entries()) {
      expect((await signInWithApple(new Browser(), { sub: `001.ok${i}`, email: "second-owner@example.com", emailVerified: verified })).location, String(verified)).not.toContain("error=");
      await reset();
    }
    for (const [i, verified] of ["false", false].entries()) {
      expect((await signInWithApple(new Browser(), { sub: `001.no${i}`, email: "second-owner@example.com", emailVerified: verified })).location, String(verified)).toContain("error=AccessDenied");
    }
  });

  it("admits a shared address with a pending email invitation, who then joins by that address", async () => {
    const owner = await makeActor("owner@example.com", "Link Lin");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const invite = await createInvitation(db(), owner, tripId, "friend@icloud.com", new Date());
    const browser = new Browser();
    expect((await signInWithApple(browser, { sub: "001.friend", email: "Friend@iCloud.com" })).location).not.toContain("error=");
    const user = (await users()).find((u) => u.email === "friend@icloud.com")!;
    const hash = await stageInvitation(db(), invite.invitationUrl.split("#")[1]!, new Date());
    await acceptInvitation(db(), actorFor({ id: user.id, email: user.email }), hash, new Date());
    expect((await getTripDetail(db(), actorFor({ id: user.id, email: user.email }), tripId, new Date())).trip).toMatchObject({ role: "viewer", ownerName: "Link Lin" });
  });

  it("admits a hidden address only by an unused invitation by link, as an account with a name and no email, which then joins", async () => {
    const browser = new Browser();
    const { tripId, hash } = await stagedLink(browser, "editor");
    const person: Person = { sub: "001.mei", email: "x1y2@privaterelay.appleid.com", relay: "true", user: { name: { firstName: "Mei", lastName: "Chen" } } };
    const { location } = await signInWithApple(browser, person, { withUser: true, callbackUrl: "/invite" });
    expect(location).toBe(`${APP}/invite`);
    const mei = (await users()).find((u) => u.name === "Mei Chen")!;
    expect(mei).toMatchObject({ email: null, image: null }); // the relay address is never kept
    expect(await accounts()).toEqual([expect.objectContaining({ provider: "apple", providerAccountId: "001.mei", userId: mei.id, access_token: null, id_token: null })]);
    const actor = actorFor({ id: mei.id, email: null });
    expect(actor).toMatchObject({ email: null, isOwner: false });
    await acceptInvitation(db(), actor, hash, new Date());
    expect((await getTripDetail(db(), actor, tripId, new Date())).trip).toMatchObject({ role: "editor", ownerName: "Link Lin" });
  });

  it("treats a private-flagged address on any domain as hidden, and never lets a relay address match an invitation by email", async () => {
    const owner = await makeActor("owner@example.com");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    await createInvitation(db(), owner, tripId, "x1y2@privaterelay.appleid.com", new Date()); // an owner who pasted a relay address
    await createInvitation(db(), owner, tripId, "alias@icloud.com", new Date());
    expect((await signInWithApple(new Browser(), { sub: "001.relay", email: "x1y2@privaterelay.appleid.com", relay: "true" })).location).toContain("error=AccessDenied");
    expect((await signInWithApple(new Browser(), { sub: "001.alias", email: "alias@icloud.com", relay: true })).location).toContain("error=AccessDenied");
  });

  it("doesn't admit it for an invitation by email, or for a link already used", async () => {
    const owner = await makeActor("owner@example.com");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const byEmail = await createInvitation(db(), owner, tripId, "someone@example.com", new Date());
    const staged = new Browser();
    staged.set(stageCookieName(APP), (await stageInvitation(db(), byEmail.invitationUrl.split("#")[1]!, new Date())).toString("hex"));
    expect((await signInWithApple(staged, { sub: "001.one", email: "x@privaterelay.appleid.com", relay: true })).location).toContain("error=AccessDenied");
    const link = await createLinkInvitation(db(), owner, tripId, "Sam", new Date());
    const hash = await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date());
    await acceptInvitation(db(), await makeActor("first@example.com"), hash, new Date());
    const second = new Browser();
    second.set(stageCookieName(APP), hash.toString("hex"));
    expect((await signInWithApple(second, { sub: "001.two", email: "y@privaterelay.appleid.com", relay: true })).location).toContain("error=AccessDenied");
  });
});

describe("the name Apple sends once", () => {
  it("is empty when Apple didn't send it, malformed, or without a name, and sign-in still works", async () => {
    const cases: Array<[string, Options["tamper"]]> = [
      ["absent", undefined],
      ["malformed", (f) => ({ ...f, user: "{not json" })],
      ["without a name", (f) => ({ ...f, user: JSON.stringify({ email: "x@example.com" }) })],
      ["null", (f) => ({ ...f, user: "null" })],
    ];
    for (const [label, tamper] of cases) {
      await reset();
      const browser = new Browser();
      const { location } = await signInWithApple(browser, { sub: "001.noname", email: "second-owner@example.com" }, { tamper });
      expect(location, label).not.toContain("error=");
      expect((await users())[0], label).toMatchObject({ name: null });
    }
  });

  it("is not read from the unsigned field for the address, only for the name", async () => {
    const browser = new Browser();
    await signInWithApple(browser, { sub: "001.sam", email: "second-owner@example.com", user: { name: { firstName: "Sam" }, email: "owner@example.com" } }, { withUser: true });
    expect((await users())[0]).toMatchObject({ name: "Sam", email: "second-owner@example.com" });
  });
});

describe("signing in again, and connecting Apple to an account", () => {
  const person: Person = { sub: "001.sam", email: "second-owner@example.com", user: { name: { firstName: "Sam", lastName: "Owner" } } };

  it("lets an identity that is already linked sign in again, to the same account, with no invitation and no `user` field", async () => {
    await signInWithApple(new Browser(), person, { withUser: true });
    const again = new Browser();
    expect((await signInWithApple(again, { sub: "001.sam", email: "changed@example.com" })).location).toBe(`${APP}/`); // even with a changed address
    expect(await users()).toHaveLength(1);
    expect(await accounts()).toHaveLength(1);
    expect((await users())[0]).toMatchObject({ name: "Sam Owner" });
  });

  async function signedIn(email: string | null, name = "Link Lin") {
    const [user] = await db().insertInto("User").values({ email, name, emailVerified: null, image: null }).returning(["id", "email"]).execute();
    const token = crypto.randomUUID();
    await db().insertInto("Session").values({ userId: user!.id, sessionToken: token, expires: new Date(Date.now() + 864e5) }).execute();
    await db().insertInto("Account").values({ userId: user!.id, type: "oidc", provider: "google", providerAccountId: `g-${user!.id}` }).execute();
    const browser = new Browser();
    browser.set(SESSION, token); // SameSite=Lax: Apple's POST would not carry it
    return { user: user!, browser };
  }

  it("links it to the signed-in account with no invitation and no new account, even when it hides its address", async () => {
    const { user, browser } = await signedIn("owner@example.com");
    expect((await signInWithApple(browser, { sub: "001.link", email: "x1y2@privaterelay.appleid.com", relay: "true" })).location).toBe(`${APP}/`);
    expect(await users()).toHaveLength(1);
    expect((await accounts()).map((a) => [a.provider, a.userId])).toEqual([["google", user.id], ["apple", user.id]]);
    expect((await users())[0]).toMatchObject({ email: "owner@example.com" }); // the relay address is not adopted, and nothing is replaced
  });

  it("gives an account that has no email the address Apple shares, once", async () => {
    const { user, browser } = await signedIn(null, "Mei");
    await signInWithApple(browser, { sub: "001.link", email: "mei@example.com" });
    expect((await users()).find((u) => u.id === user.id)).toMatchObject({ email: "mei@example.com" });
    const again = await signedIn(null, "Other");
    await signInWithApple(again.browser, { sub: "001.link2", email: "other@example.com" });
    await signInWithApple(again.browser, { sub: "001.link3", email: "third@example.com" });
    expect((await users()).find((u) => u.id === again.user.id)).toMatchObject({ email: "other@example.com" }); // never replaced
  });

  it("leaves an account without an email when the address Apple shares belongs to another account", async () => {
    await makeActor("taken@example.com");
    const { user, browser } = await signedIn(null, "Mei");
    expect((await signInWithApple(browser, { sub: "001.link", email: "taken@example.com" })).location).toBe(`${APP}/`);
    expect((await users()).find((u) => u.id === user.id)).toMatchObject({ email: null });
    expect((await accounts()).some((a) => a.provider === "apple" && a.userId === user.id)).toBe(true);
  });

  it("refuses an identity that already belongs to another account, changing nothing", async () => {
    const other = await makeActor("other@example.com");
    await db().insertInto("Account").values({ userId: other.userId, type: "oidc", provider: "apple", providerAccountId: "001.taken" }).execute();
    const { browser } = await signedIn("owner@example.com");
    expect((await signInWithApple(browser, { sub: "001.taken", email: "x@privaterelay.appleid.com", relay: true })).location).toContain("error=OAuthAccountNotLinked");
    expect((await accounts()).filter((a) => a.provider === "apple").map((a) => a.userId)).toEqual([other.userId]);
  });

  it("does not count an expired session as signed in", async () => {
    const user = await makeActor("owner@example.com");
    await db().insertInto("Session").values({ userId: user.userId, sessionToken: "old", expires: new Date(Date.now() - 1000) }).execute();
    const browser = new Browser();
    browser.set(SESSION, "old");
    expect((await signInWithApple(browser, { sub: "001.late", email: "x@privaterelay.appleid.com", relay: true })).location).toContain("error=AccessDenied");
  });

  it("never links by email: a shared address that belongs to a Google-only account is refused, with nothing linked", async () => {
    const owner = await makeActor("owner@example.com", "Link Lin");
    await db().insertInto("Account").values({ userId: owner.userId, type: "oidc", provider: "google", providerAccountId: "g-owner" }).execute();
    const browser = new Browser();
    expect((await signInWithApple(browser, { sub: "001.same", email: "owner@example.com" })).location).toContain("error=OAuthAccountNotLinked");
    expect(browser.has("session-token")).toBe(false);
    expect((await accounts()).map((a) => a.provider)).toEqual(["google"]);
    expect(await users()).toHaveLength(1);
  });
});
