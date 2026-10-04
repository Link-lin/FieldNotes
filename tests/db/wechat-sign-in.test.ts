import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Auth } from "@auth/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeActor, NOW, reset, testDb, tripInput } from "./helpers";
import { authConfig } from "@/server/auth/config";
import { adoptVerifiedEmail } from "@/server/auth/link-account";
import { allowSignIn, cookieValue, signedInUserId } from "@/server/auth/sign-in-gate";
import { acceptInvitation, createLinkInvitation, stageInvitation, createInvitation } from "@/server/modules/invitations/invitations.service";
import { getTripDetail, createTrip } from "@/server/modules/trips/trips.service";
import { actorFor } from "@/server/auth/actor";

/**
 * Signing in with WeChat, end to end through Auth.js itself (its OAuth state, token exchange, profile call, sign-in
 * gate, account creation and session) against a stand-in for WeChat's two hosts. Only WeChat is simulated; the
 * requests Auth.js makes to it are checked against what WeChat documents.
 */

type Seen = { method: string; path: string; query: Record<string, string> };
let wechat: Server;
let origin = "";
const seen: Seen[] = [];

/** A stand-in for WeChat: codes starting "ok-" are good; each yields a person named after the code. */
function fakeWeChat(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, "http://stand-in");
  const query = Object.fromEntries(url.searchParams);
  seen.push({ method: req.method!, path: url.pathname, query });
  // WeChat answers JSON as text/plain.
  const reply = (body: unknown) => {
    res.setHeader("content-type", "text/plain");
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/sns/oauth2/access_token") {
    if (req.method !== "GET" || query.appid !== "wx123" || query.secret !== "s3cret" || query.grant_type !== "authorization_code") return reply({ errcode: 41002, errmsg: "appid missing" });
    if (!query.code?.startsWith("ok-")) return reply({ errcode: 40029, errmsg: "invalid code" });
    const who = query.code.slice(3);
    return reply({ access_token: `at-${who}`, expires_in: 7200, refresh_token: `rt-${who}`, openid: `o-${who}`, scope: "snsapi_userinfo", unionid: `u-${who}` });
  }
  if (url.pathname === "/sns/userinfo") {
    const who = (query.access_token ?? "").slice(3);
    return reply({ openid: `o-${who}`, nickname: `Mei ${who}`, headimgurl: "http://thirdwx.qlogo.cn/avatar", unionid: `u-${who}` });
  }
  res.statusCode = 404;
  res.end();
}

beforeAll(async () => {
  wechat = createServer(fakeWeChat);
  await new Promise<void>((resolve) => wechat.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(wechat.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => wechat.close(() => resolve())));

const APP = "http://localhost:3000";
const db = () => testDb();

beforeEach(async () => {
  await reset();
  seen.length = 0;
  vi.stubEnv("AUTH_SECRET", "a-test-secret-for-the-sign-in-flow-only-0123456789");
  vi.stubEnv("AUTH_WECHAT_ID", "wx123");
  vi.stubEnv("AUTH_WECHAT_SECRET", "s3cret");
  vi.stubEnv("AUTH_WECHAT_PLATFORM", "");
  vi.stubEnv("WECHAT_OPEN_ORIGIN", origin);
  vi.stubEnv("WECHAT_API_ORIGIN", origin);
  vi.stubEnv("AUTH_URL", APP);
});

/** A browser's cookies across the requests of one sign-in. */
class Jar {
  private cookies = new Map<string, string>();
  set(name: string, value: string) {
    this.cookies.set(name, value);
  }
  get header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** Auth.js, configured as the app configures it, reading the jar's cookies the way the app reads the request's. */
function authFor(jar: Jar) {
  const config = { ...authConfig(db(), async () => jar.header || null), secret: process.env.AUTH_SECRET, trustHost: true, basePath: "/api/auth" };
  return (path: string, init: RequestInit = {}) => Auth(new Request(`${APP}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: jar.header } }), config);
}

/** The whole dance: start at /signin/wechat, "approve" at WeChat with `code`, return to the callback. */
async function signInWith(jar: Jar, code: string | null) {
  const auth = authFor(jar);
  const csrfRes = await auth("/api/auth/csrf");
  jar.take(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const start = await auth("/api/auth/signin/wechat", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/" }),
  });
  jar.take(start);
  const authorizeUrl = start.headers.get("location")!;
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  const back = new URLSearchParams(code ? { code, state } : { state }); // declining returns only the state
  const done = await authFor(jar)(`/api/auth/callback/wechat?${back}`);
  jar.take(done);
  return { authorizeUrl, location: done.headers.get("location") ?? "", status: done.status };
}

const accounts = () => db().selectFrom("Account").selectAll().execute();
const users = () => db().selectFrom("User").selectAll().execute();

describe("sending someone to WeChat", () => {
  it("builds WeChat's in-app authorization address, with the app ID, scope, callback and state, ending in #wechat_redirect", async () => {
    const jar = new Jar();
    const { authorizeUrl } = await signInWith(jar, null);
    expect(authorizeUrl.startsWith(`${origin}/connect/oauth2/authorize?`)).toBe(true);
    expect(authorizeUrl.endsWith("#wechat_redirect")).toBe(true);
    const asked = new URL(authorizeUrl);
    expect(asked.searchParams.get("appid")).toBe("wx123");
    expect(asked.searchParams.get("scope")).toBe("snsapi_userinfo");
    expect(asked.searchParams.get("response_type")).toBe("code");
    expect(asked.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback/wechat`);
    expect(asked.searchParams.get("state")).toBeTruthy();
    expect(authorizeUrl).not.toContain("s3cret"); // the secret never goes through the browser
  });

  it("uses the QR code page for a website app", async () => {
    vi.stubEnv("AUTH_WECHAT_PLATFORM", "WebsiteApp");
    const { authorizeUrl } = await signInWith(new Jar(), null);
    expect(authorizeUrl.startsWith(`${origin}/connect/qrconnect?`)).toBe(true);
    expect(new URL(authorizeUrl).searchParams.get("scope")).toBe("snsapi_login");
  });
});

describe("the sign-in gate for WeChat", () => {
  it("turns away a new WeChat identity that arrives without an invitation, creating nothing", async () => {
    const jar = new Jar();
    const { location } = await signInWith(jar, "ok-stranger");
    expect(location).toContain("error=AccessDenied");
    expect(await users()).toEqual([]);
    expect(await accounts()).toEqual([]);
    expect(jar.header).not.toContain("session-token");
  });

  it("admits it with an unused invitation by link, as an account with a nickname and no email, keeping no tokens", async () => {
    const owner = await makeActor("owner@example.com", "Link Lin");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const link = await createLinkInvitation(db(), owner, tripId, "Mei, on WeChat", new Date(), "editor");
    const hash = await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date());
    const jar = new Jar();
    jar.set("fieldnotes-invite", hash.toString("hex")); // set by /invite before the sign-in
    const { location } = await signInWith(jar, "ok-mei");
    expect(location).toBe(`${APP}/`);
    expect(jar.header).toContain("authjs.session-token=");
    const user = (await users()).find((u) => u.email === null);
    expect(user).toMatchObject({ name: "Mei mei", email: null, image: null });
    expect(await accounts()).toEqual([expect.objectContaining({ provider: "wechat", providerAccountId: "u-mei", userId: user!.id, access_token: null, refresh_token: null })]);
    // Landing back on /invite, the account accepts the staged link and joins with the chosen role.
    const mei = actorFor({ id: user!.id, email: null });
    await acceptInvitation(db(), mei, hash, new Date());
    expect((await getTripDetail(db(), mei, tripId, new Date())).trip).toMatchObject({ role: "editor", ownerName: "Link Lin" });
  });

  it("asks WeChat the way WeChat documents it: a GET with the app ID, secret and code, then the profile", async () => {
    const owner = await makeActor("owner@example.com");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", new Date());
    const jar = new Jar();
    jar.set("fieldnotes-invite", (await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date())).toString("hex"));
    await signInWith(jar, "ok-mei");
    const token = seen.find((s) => s.path === "/sns/oauth2/access_token")!;
    expect(token).toMatchObject({ method: "GET", query: { appid: "wx123", secret: "s3cret", code: "ok-mei", grant_type: "authorization_code" } });
    expect(seen.find((s) => s.path === "/sns/userinfo")).toMatchObject({ method: "GET", query: { access_token: "at-mei", openid: "o-mei" } });
  });

  it("doesn't admit it for an invitation by email, which it can't satisfy, or for a link already used", async () => {
    const owner = await makeActor("owner@example.com");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const byEmail = await createInvitation(db(), owner, tripId, "someone@example.com", new Date());
    const jar = new Jar();
    jar.set("fieldnotes-invite", (await stageInvitation(db(), byEmail.invitationUrl.split("#")[1]!, new Date())).toString("hex"));
    expect((await signInWith(jar, "ok-one")).location).toContain("error=AccessDenied");
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", new Date());
    const hash = await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date());
    const first = await makeActor("first@example.com");
    await acceptInvitation(db(), first, hash, new Date());
    const second = new Jar();
    second.set("fieldnotes-invite", hash.toString("hex"));
    expect((await signInWith(second, "ok-two")).location).toContain("error=AccessDenied");
  });

  it("lets an identity that is already linked sign in again, to the same account", async () => {
    const owner = await makeActor("owner@example.com");
    const tripId = (await createTrip(db(), owner, tripInput, NOW)).id;
    const link = await createLinkInvitation(db(), owner, tripId, "Mei", new Date());
    const joined = new Jar();
    joined.set("fieldnotes-invite", (await stageInvitation(db(), link.invitationUrl.split("#")[1]!, new Date())).toString("hex"));
    await signInWith(joined, "ok-mei");
    const again = new Jar(); // a fresh browser, no invitation
    expect((await signInWith(again, "ok-mei")).location).toBe(`${APP}/`);
    expect(await users()).toHaveLength(2); // the owner and Mei, not a third
    expect(await accounts()).toHaveLength(1);
  });

  it("answers a refusal or a bad code at WeChat with the sign-in error page, not a session", async () => {
    const jar = new Jar();
    expect((await signInWith(jar, null)).location).toContain("error="); // declined: only the state comes back
    expect((await signInWith(new Jar(), "nope")).location).toContain("error=");
    expect(jar.header).not.toContain("session-token");
    expect(await users()).toEqual([]);
  });
});

describe("connecting WeChat to an account that is signed in", () => {
  async function signedInGoogleUser() {
    const user = await makeActor("owner@example.com", "Link Lin");
    const token = crypto.randomUUID();
    await db().insertInto("Session").values({ userId: user.userId, sessionToken: token, expires: new Date(Date.now() + 864e5) }).execute();
    await db().insertInto("Account").values({ userId: user.userId, type: "oidc", provider: "google", providerAccountId: "g-owner" }).execute();
    const jar = new Jar();
    jar.set("authjs.session-token", token);
    return { user, jar };
  }

  it("links it to the same account, with no invitation and no new account", async () => {
    const { user, jar } = await signedInGoogleUser();
    expect((await signInWith(jar, "ok-link")).location).toBe(`${APP}/`);
    expect(await users()).toHaveLength(1);
    const linked = await accounts();
    expect(linked.map((a) => [a.provider, a.userId])).toEqual([["google", user.userId], ["wechat", user.userId]]);
  });

  it("refuses an identity that already belongs to another account, changing nothing", async () => {
    const other = await makeActor("other@example.com");
    await db().insertInto("Account").values({ userId: other.userId, type: "oauth", provider: "wechat", providerAccountId: "u-taken" }).execute();
    const { jar } = await signedInGoogleUser();
    expect((await signInWith(jar, "ok-taken")).location).toContain("error=OAuthAccountNotLinked");
    expect((await accounts()).filter((a) => a.provider === "wechat").map((a) => a.userId)).toEqual([other.userId]);
  });

  it("does not count an expired session as signed in", async () => {
    const user = await makeActor("owner@example.com");
    await db().insertInto("Session").values({ userId: user.userId, sessionToken: "old", expires: new Date(Date.now() - 1000) }).execute();
    const jar = new Jar();
    jar.set("authjs.session-token", "old");
    expect((await signInWith(jar, "ok-late")).location).toContain("error=AccessDenied");
  });
});

describe("the helpers behind the gate", () => {
  it("reads one cookie out of a Cookie header", () => {
    expect(cookieValue("a=1; authjs.session-token=abc; b=2", "authjs.session-token")).toBe("abc");
    expect(cookieValue("a=1", "authjs.session-token")).toBeNull();
    expect(cookieValue(null, "a")).toBeNull();
    expect(cookieValue("x-authjs.session-token=nope", "authjs.session-token")).toBeNull();
  });

  it("finds the signed-in account from a live session only", async () => {
    const user = await makeActor("owner@example.com");
    await db().insertInto("Session").values({ userId: user.userId, sessionToken: "live", expires: new Date(Date.now() + 1000 * 60) }).execute();
    await db().insertInto("Session").values({ userId: user.userId, sessionToken: "dead", expires: new Date(Date.now() - 1000) }).execute();
    expect(await signedInUserId(db(), APP, "authjs.session-token=live")).toBe(user.userId);
    expect(await signedInUserId(db(), APP, "authjs.session-token=dead")).toBeNull();
    expect(await signedInUserId(db(), APP, "authjs.session-token=unknown")).toBeNull();
    expect(await signedInUserId(db(), APP, null)).toBeNull();
    expect(await signedInUserId(db(), "https://notes.example.com", "__Secure-authjs.session-token=live")).toBe(user.userId); // the HTTPS cookie name
  });

  it("lets a signed-in visitor connect a method without an invitation or a verified email, and nobody else", async () => {
    const attempt = { provider: "google", providerAccountId: "g-new", email: "new@example.com", emailVerified: false };
    expect(await allowSignIn(db(), attempt)).toBe(false);
    expect(await allowSignIn(db(), { ...attempt, signedInUserId: crypto.randomUUID() })).toBe(true);
    expect(await allowSignIn(db(), { provider: "wechat", providerAccountId: "u-new", email: null, emailVerified: null })).toBe(false);
    expect(await allowSignIn(db(), { provider: "github", providerAccountId: "x", email: "a@example.com", emailVerified: true })).toBe(false);
  });
});

describe("connecting Google to an account that signed in with WeChat", () => {
  const mei = async () => (await db().insertInto("User").values({ email: null, name: "Mei", emailVerified: null, image: null }).returning("id").executeTakeFirstOrThrow()).id;
  const emailOf = async (id: string) => (await db().selectFrom("User").select("email").where("id", "=", id).executeTakeFirstOrThrow()).email;

  it("gives it the verified Google address, once", async () => {
    const id = await mei();
    await adoptVerifiedEmail(db(), id, "google", { email: "  Mei@Example.com ", email_verified: true });
    expect(await emailOf(id)).toBe("mei@example.com");
    await adoptVerifiedEmail(db(), id, "google", { email: "other@example.com", email_verified: true });
    expect(await emailOf(id)).toBe("mei@example.com"); // never replaced
  });

  it("never adopts an unverified address or one from another provider", async () => {
    const id = await mei();
    await adoptVerifiedEmail(db(), id, "google", { email: "mei@example.com", email_verified: false });
    await adoptVerifiedEmail(db(), id, "google", { email: "mei@example.com" });
    await adoptVerifiedEmail(db(), id, "wechat", { email: "mei@example.com", email_verified: true });
    expect(await emailOf(id)).toBeNull();
  });

  it("leaves an address another account holds alone, without failing", async () => {
    await makeActor("taken@example.com");
    const id = await mei();
    await adoptVerifiedEmail(db(), id, "google", { email: "taken@example.com", email_verified: true });
    expect(await emailOf(id)).toBeNull();
  });

  it("lets the account then match the owner allowlist", async () => {
    const id = await mei();
    await adoptVerifiedEmail(db(), id, "google", { email: "owner@example.com", email_verified: true });
    expect(actorFor({ id, email: await emailOf(id) })).toMatchObject({ email: "owner@example.com", isOwner: true });
  });
});

