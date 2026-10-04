import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wechatConfig, wechatEnabled, weChatFetch, wechatOrigins, wechatProvider } from "@/server/auth/wechat";

const env = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
};
beforeEach(() => {
  for (const k of ["AUTH_WECHAT_ID", "AUTH_WECHAT_SECRET", "AUTH_WECHAT_PLATFORM", "WECHAT_OPEN_ORIGIN", "WECHAT_API_ORIGIN"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WeChat configuration", () => {
  it("is off unless both the app ID and the secret are set", () => {
    expect(wechatEnabled()).toBe(false);
    env({ AUTH_WECHAT_ID: "wx123" });
    expect(wechatConfig()).toBeNull();
    env({ AUTH_WECHAT_SECRET: "s3cret" });
    expect(wechatConfig()).toEqual({ appId: "wx123", secret: "s3cret", platform: "OfficialAccount" });
    expect(wechatEnabled()).toBe(true);
  });

  it("uses the in-WeChat platform unless the website QR platform is chosen", () => {
    env({ AUTH_WECHAT_ID: "wx123", AUTH_WECHAT_SECRET: "s3cret", AUTH_WECHAT_PLATFORM: "WebsiteApp" });
    expect(wechatConfig()!.platform).toBe("WebsiteApp");
    env({ AUTH_WECHAT_PLATFORM: "anything else" });
    expect(wechatConfig()!.platform).toBe("OfficialAccount");
  });

  it("refuses to build a provider without credentials, and uses WeChat's own hosts by default", () => {
    expect(() => wechatProvider()).toThrow("not configured");
    expect(wechatOrigins()).toEqual({ open: "https://open.weixin.qq.com", api: "https://api.weixin.qq.com" });
    env({ WECHAT_OPEN_ORIGIN: "http://localhost:4010/", WECHAT_API_ORIGIN: "http://localhost:4011" });
    expect(wechatOrigins()).toEqual({ open: "http://localhost:4010", api: "http://localhost:4011" });
  });
});

describe("the WeChat provider", () => {
  const provider = () => {
    env({ AUTH_WECHAT_ID: "wx123", AUTH_WECHAT_SECRET: "s3cret" });
    return wechatProvider();
  };

  it("sends people to WeChat's in-app authorization page, whose address must end in #wechat_redirect", () => {
    const p = provider();
    expect(p).toMatchObject({ id: "wechat", name: "WeChat", type: "oauth", checks: ["state"] });
    const auth = p.authorization as { url: string; params: Record<string, string> };
    expect(auth.url).toBe("https://open.weixin.qq.com/connect/oauth2/authorize#wechat_redirect");
    expect(auth.params).toEqual({ appid: "wx123", scope: "snsapi_userinfo" });
    // Auth.js adds its parameters through URL#searchParams, which keeps the fragment last.
    const built = new URL(auth.url);
    built.searchParams.set("redirect_uri", "https://notes.example.com/api/auth/callback/wechat");
    expect(built.toString().endsWith("#wechat_redirect")).toBe(true);
    expect(built.search).toContain("redirect_uri=");
  });

  it("uses the QR code page on a desktop browser for a website app", () => {
    env({ AUTH_WECHAT_PLATFORM: "WebsiteApp" });
    const auth = provider().authorization as { url: string; params: Record<string, string> };
    expect(auth.url).toBe("https://open.weixin.qq.com/connect/qrconnect#wechat_redirect");
    expect(auth.params.scope).toBe("snsapi_login");
  });

  it("keeps the app's ID and secret in the token endpoint's query, where WeChat reads them", () => {
    const token = provider().token as { url: string; params: Record<string, string> };
    expect(token.url).toBe("https://api.weixin.qq.com/sns/oauth2/access_token");
    expect(token.params).toEqual({ appid: "wx123", secret: "s3cret" });
  });

  it("identifies the account by unionid when WeChat gives one, else by openid, with no email and no avatar", async () => {
    const profile = provider().profile!;
    expect(await profile({ openid: "o1", unionid: "u1", nickname: "Mei 🌸", headimgurl: "http://thirdwx.qlogo.cn/x" }, {})).toEqual({ id: "u1", name: "Mei 🌸", email: null, image: null });
    expect(await profile({ openid: "o2" }, {})).toEqual({ id: "o2", name: null, email: null, image: null });
  });

  it("reads the user's profile with the access token and openid, and refuses an error answer", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ openid: "o1", nickname: "Mei" }), { headers: { "content-type": "text/plain" } });
    });
    const userinfo = provider().userinfo as { url: string; request: (ctx: unknown) => Promise<unknown> };
    const ctx = { tokens: { access_token: "tok", openid: "o1" }, provider: { userinfo: { url: new URL(userinfo.url) } } };
    expect(await userinfo.request(ctx)).toEqual({ openid: "o1", nickname: "Mei" });
    expect(new URL(seen[0]!).searchParams.get("access_token")).toBe("tok");
    expect(new URL(seen[0]!).searchParams.get("openid")).toBe("o1");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid credential" })));
    await expect(userinfo.request(ctx)).rejects.toThrow("did not return");
  });
});

describe("WeChat's token endpoint", () => {
  const tokenUrl = "https://api.weixin.qq.com/sns/oauth2/access_token?appid=wx123&secret=s3cret";
  const stub = (answer: () => Response) => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return answer();
    });
    return calls;
  };

  it("is asked the way WeChat documents it: a GET with the code in the query string", async () => {
    const calls = stub(() => new Response(JSON.stringify({ access_token: "tok", expires_in: 7200, openid: "o1" }), { headers: { "content-type": "text/plain" } }));
    const res = await weChatFetch(tokenUrl, { method: "POST", body: new URLSearchParams({ code: "abc", redirect_uri: "https://x", grant_type: "authorization_code" }) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    const asked = new URL(calls[0]!.url);
    expect(Object.fromEntries(asked.searchParams)).toEqual({ appid: "wx123", secret: "s3cret", code: "abc", grant_type: "authorization_code" });
    // Its text/plain JSON becomes an answer Auth.js accepts.
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ access_token: "tok", expires_in: 7200, openid: "o1", token_type: "bearer" });
  });

  it("turns WeChat's errors, sent with a 200, into an OAuth error", async () => {
    stub(() => new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" })));
    const res = await weChatFetch(tokenUrl, { method: "POST", body: "code=bad" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant", error_description: "invalid code" });
    stub(() => new Response("not json at all"));
    expect((await weChatFetch(tokenUrl, { method: "POST", body: "code=bad" })).status).toBe(400);
  });

  it("leaves every other request alone", async () => {
    const calls = stub(() => new Response("ok"));
    await weChatFetch("https://api.weixin.qq.com/sns/userinfo?x=1", { method: "GET" });
    expect(calls).toEqual([{ url: "https://api.weixin.qq.com/sns/userinfo?x=1", method: "GET" }]);
  });
});
