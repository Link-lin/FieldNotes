import "server-only";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import Apple from "next-auth/providers/apple";
import { verifiedEmail } from "@/server/auth/identity";

/** What Sign in with Apple needs from the host: the Services ID, and the team's signing key (see the README). */
export type AppleConfig = { servicesId: string; teamId: string; keyId: string; privateKey: string };

/** The four settings Sign in with Apple needs. */
const SETTINGS = ["AUTH_APPLE_ID", "AUTH_APPLE_TEAM_ID", "AUTH_APPLE_KEY_ID", "AUTH_APPLE_PRIVATE_KEY"] as const;

/** The app's Apple credentials, or null when Sign in with Apple isn't set up (it needs all four). */
export function appleConfig(): AppleConfig | null {
  const servicesId = process.env.AUTH_APPLE_ID?.trim();
  const teamId = process.env.AUTH_APPLE_TEAM_ID?.trim();
  const keyId = process.env.AUTH_APPLE_KEY_ID?.trim();
  const privateKey = process.env.AUTH_APPLE_PRIVATE_KEY?.trim();
  return servicesId && teamId && keyId && privateKey ? { servicesId, teamId, keyId, privateKey } : null;
}

/** Apple's sign-in host. It is fixed; the override exists only to point a test at a stand-in (see `APPLE_ORIGIN` in the README). */
export const appleOrigin = (): string => (process.env.APPLE_ORIGIN?.trim() || "https://appleid.apple.com").replace(/\/+$/, "");

/**
 * The signing key from its environment value: the `.p8` file's PEM (a one-line variable writes the line breaks as
 * `\n`), or just the base64 between its BEGIN and END lines. It must be the P-256 key Apple issues.
 */
export function applePrivateKey(value: string): KeyObject {
  const text = value.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\\n/g, "\n").trim();
  let key: KeyObject;
  try {
    key = text.includes("-----BEGIN") ? createPrivateKey(text) : createPrivateKey({ key: Buffer.from(text.replace(/\s+/g, ""), "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new Error("AUTH_APPLE_PRIVATE_KEY is not a key Node can read; it must be the PEM from the .p8 file Apple gives you");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("AUTH_APPLE_PRIVATE_KEY is not a P-256 key; it must be the .p8 file Apple gives you");
  }
  return key;
}

const base64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

/** A client secret lasts an hour (Apple allows six months) and is reused for half of that. */
const SECRET_LIFETIME_S = 60 * 60;
const SECRET_REUSE_MS = 30 * 60 * 1000;

/**
 * Apple takes no fixed secret: the client secret is a short-lived ES256 token the app signs with its key. `iss` is the
 * Team ID, `sub` the Services ID, `aud` Apple and `kid` the key's ID. `iat` sits a minute in the past so a clock a
 * little ahead of Apple's still works.
 */
export function appleClientSecret(config: AppleConfig, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const claims = { iss: config.teamId, iat, exp: iat + SECRET_LIFETIME_S, aud: appleOrigin(), sub: config.servicesId };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(input), { key: applePrivateKey(config.privateKey), dsaEncoding: "ieee-p1363" });
  return `${input}.${base64url(signature)}`;
}

let cached: { id: string; secret: string; at: number } | null = null;

/** The client secret for the current credentials, signed once and reused: the configuration is built on every request. */
export function cachedAppleClientSecret(config: AppleConfig, now = new Date()): string {
  const id = [config.servicesId, config.teamId, config.keyId, config.privateKey, appleOrigin()].join("\n");
  if (cached && cached.id === id && now.getTime() - cached.at < SECRET_REUSE_MS) return cached.secret;
  const secret = appleClientSecret(config, now);
  cached = { id, secret, at: now.getTime() };
  return secret;
}

let reported: string | null = null;

/** Says once (per reason) why Sign in with Apple is off, so a half-finished setup doesn't just hide the button. */
function switchedOff(reason: string): false {
  if (reported !== reason) {
    reported = reason;
    console.error(`[auth] Sign in with Apple is switched off: ${reason}`);
  }
  return false;
}

/**
 * Whether Sign in with Apple is set up and its key can sign. A key that can't would fail every sign-in and every
 * page that builds the configuration, so the button stays hidden instead and the reason is logged once. Nothing is
 * said when none of the four settings is present: then Apple was never asked for.
 */
export function appleEnabled(): boolean {
  const config = appleConfig();
  if (!config) {
    const missing = SETTINGS.filter((name) => !process.env[name]?.trim());
    return missing.length === SETTINGS.length ? false : switchedOff(`it needs all four settings; missing ${missing.join(", ")}`);
  }
  try {
    cachedAppleClientSecret(config);
    return true;
  } catch (err) {
    return switchedOff(err instanceof Error ? err.message : "its key can't sign");
  }
}

/** What Apple's ID token carries, and the `user` field it posts the first time someone approves the app. */
export type AppleClaims = {
  sub: string;
  email?: unknown;
  email_verified?: unknown;
  is_private_email?: unknown;
  user?: { name?: { firstName?: unknown; lastName?: unknown } } | null;
};

/** A name as shown in the app: one line, no control or direction-changing characters, at most 80 characters. */
const cleanName = (value: unknown): string => (typeof value === "string" ? value.replace(/[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, " ").replace(/\s+/g, " ").trim() : "");

/**
 * The name Apple sent, or null. It arrives once, in the `user` form field, and through the browser rather than in
 * the signed ID token, so it is the person's own say-so, like any display name; the email is never read from it.
 */
export function appleName(claims: Pick<AppleClaims, "user">): string | null {
  const name = claims.user?.name;
  const joined = [cleanName(name?.firstName), cleanName(name?.lastName)].filter(Boolean).join(" ").slice(0, 80).trim();
  return joined || null;
}

/**
 * Sign in with Apple (ACCESS-1): Auth.js's own Apple provider, with the client secret the app signs, only a verified
 * address the person didn't hide (see `verifiedEmail`), the name when Apple sent one, no avatar and no stored token.
 * The built-in mapping is replaced because it throws on a `user` field without a name. Apple's callback needs
 * `apple-return.ts` to carry it back to the app (see the technical design).
 */
export function appleProvider() {
  const config = appleConfig();
  if (!config) throw new Error("Sign in with Apple is not configured.");
  return Apple({
    clientId: config.servicesId,
    clientSecret: cachedAppleClientSecret(config),
    issuer: appleOrigin(),
    account: () => ({}),
    profile: (claims: AppleClaims) => ({ id: claims.sub, name: appleName(claims), email: verifiedEmail("apple", claims), image: null }),
  });
}
