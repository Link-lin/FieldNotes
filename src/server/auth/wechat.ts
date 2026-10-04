import "server-only";
import type { OAuth2Config } from "next-auth/providers";

/** `OfficialAccount` signs people in inside WeChat's own browser; `WebsiteApp` shows a QR code for a desktop browser. */
export type WeChatPlatform = "OfficialAccount" | "WebsiteApp";

/** What WeChat's user-info call returns (the fields used). `unionid` exists only for apps under one Open Platform account. */
export type WeChatProfile = { openid: string; unionid?: string; nickname?: string; headimgurl?: string };

/** The app's WeChat credentials, or null when sign-in with WeChat isn't set up (it needs both an ID and a secret). */
export function wechatConfig(): { appId: string; secret: string; platform: WeChatPlatform } | null {
  const appId = process.env.AUTH_WECHAT_ID?.trim();
  const secret = process.env.AUTH_WECHAT_SECRET?.trim();
  if (!appId || !secret) return null;
  return { appId, secret, platform: process.env.AUTH_WECHAT_PLATFORM?.trim() === "WebsiteApp" ? "WebsiteApp" : "OfficialAccount" };
}

export const wechatEnabled = (): boolean => wechatConfig() !== null;

/**
 * WeChat's two hosts. They are fixed; the overrides exist only to point a test at a stand-in server (see
 * `WECHAT_OPEN_ORIGIN` and `WECHAT_API_ORIGIN` in the README).
 */
export function wechatOrigins(): { open: string; api: string } {
  const clean = (value: string | undefined, fallback: string) => (value?.trim() || fallback).replace(/\/+$/, "");
  return { open: clean(process.env.WECHAT_OPEN_ORIGIN, "https://open.weixin.qq.com"), api: clean(process.env.WECHAT_API_ORIGIN, "https://api.weixin.qq.com") };
}

/** WeChat answers JSON as text/plain, and reports errors as a 200 with an `errcode`; this reads either. */
async function readWeChat(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = JSON.parse(await res.text());
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * WeChat's token endpoint is not standard OAuth, so Auth.js's request is rewritten to what WeChat documents: a GET
 * with `appid`, `secret`, `code` and `grant_type` in the query string (the first two are already part of the URL).
 * Its answer is turned into one Auth.js accepts: JSON with a `token_type`, or an OAuth error for an `errcode`. The
 * response is never logged; it holds the user's access token.
 */
export async function weChatFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!url.pathname.endsWith("/sns/oauth2/access_token")) return fetch(input, init);
  const body = init?.body;
  const form = body instanceof URLSearchParams ? body : new URLSearchParams(typeof body === "string" ? body : "");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", form.get("code") ?? "");
  const data = await readWeChat(await fetch(url, { method: "GET", headers: { accept: "application/json" } }));
  if (typeof data.access_token !== "string" || data.errcode) {
    return json({ error: "invalid_grant", error_description: typeof data.errmsg === "string" ? data.errmsg : "WeChat did not accept the sign-in" }, 400);
  }
  return json({ ...data, token_type: "bearer" });
}

/**
 * Sign in with WeChat (ACCESS-1) as an Auth.js OAuth provider. Written out rather than taken from Auth.js's
 * built-in one so that three things WeChat needs are right: the authorization URL ends in `#wechat_redirect`, the
 * token call is WeChat's own GET (see `weChatFetch`), and the account is identified by `unionid` when WeChat gives
 * one and by `openid` otherwise. WeChat gives no email, and no avatar is kept: only the nickname. The caller
 * attaches `weChatFetch` as the provider's `customFetch` (see `config.ts`); it is kept apart so this file loads
 * without Auth.js.
 */
export function wechatProvider(): OAuth2Config<WeChatProfile> {
  const config = wechatConfig();
  if (!config) throw new Error("WeChat sign-in is not configured.");
  const { open, api } = wechatOrigins();
  const site = config.platform === "WebsiteApp";
  return {
    id: "wechat",
    name: "WeChat",
    type: "oauth",
    checks: ["state"],
    clientId: config.appId,
    clientSecret: config.secret,
    // WeChat requires the fragment; `URL#toString` keeps it after the query string Auth.js adds.
    authorization: { url: `${open}/connect/${site ? "qrconnect" : "oauth2/authorize"}#wechat_redirect`, params: { appid: config.appId, scope: site ? "snsapi_login" : "snsapi_userinfo" } },
    token: { url: `${api}/sns/oauth2/access_token`, params: { appid: config.appId, secret: config.secret } },
    userinfo: {
      url: `${api}/sns/userinfo`,
      async request({ tokens, provider }: { tokens: { access_token?: string; openid?: unknown }; provider: { userinfo?: { url?: URL | string } } }) {
        const url = new URL(provider.userinfo!.url!);
        url.searchParams.set("access_token", String(tokens.access_token));
        url.searchParams.set("openid", String(tokens.openid));
        url.searchParams.set("lang", "zh_CN");
        const profile = await readWeChat(await fetch(url));
        if (profile.errcode || typeof profile.openid !== "string") throw new Error("WeChat did not return the user's profile");
        return profile as WeChatProfile;
      },
    },
    profile: (p) => ({ id: p.unionid ?? p.openid, name: p.nickname ?? null, email: null, image: null }),
  };
}
