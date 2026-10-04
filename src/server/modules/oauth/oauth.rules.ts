import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ConnectorScope } from "@/server/core/db/schema";

/*
 * Pure rules for the AI connector's authorization server (technical design: AI connector): lifetimes, scopes,
 * redirect addresses, PKCE and the shape of codes and tokens. No database and no request here.
 */

/** Access tokens are short; a refresh token (and the approval's idle expiry) lasts 60 days from its last use. */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
/** A refresh token used again this soon after its first use still works: a lost answer or two racing requests. */
export const REFRESH_RETRY_MS = 30 * 1000;

export const SCOPE_READ = "trips:read";
export const SCOPE_WRITE = "trips:write";
/** What the authorization server advertises. `offline_access` is accepted and ignored: a refresh token is always issued. */
export const SCOPES_SUPPORTED = [SCOPE_READ, SCOPE_WRITE, "offline_access"] as const;

export const READ_ONLY: ConnectorScope = "trips:read";
export const READ_WRITE: ConnectorScope = "trips:read trips:write";

export const hasWrite = (scope: ConnectorScope): boolean => scope === READ_WRITE;

/** The scope an authorization request asks for: write implies read, unknown names are ignored, and none means read. */
export function requestedScope(raw: string | null | undefined): ConnectorScope {
  const names = new Set((raw ?? "").split(/\s+/).filter(Boolean));
  return names.has(SCOPE_WRITE) ? READ_WRITE : READ_ONLY;
}

/** A refresh may ask for less than it holds, never more. Null means the request asked for something it was not granted. */
export function narrowedScope(raw: string | null | undefined, held: ConnectorScope): ConnectorScope | null {
  const names = (raw ?? "").split(/\s+/).filter((n) => n && n !== "offline_access");
  if (names.length === 0) return held;
  if (names.some((n) => n !== SCOPE_READ && n !== SCOPE_WRITE)) return null;
  const asked = names.includes(SCOPE_WRITE) ? READ_WRITE : READ_ONLY;
  return asked === READ_WRITE && held !== READ_WRITE ? null : asked;
}

export type SecretKind = "code" | "access" | "refresh";
const PREFIX: Record<SecretKind, string> = { code: "fn_ac_", access: "fn_at_", refresh: "fn_rt_" };
const SECRET = { code: /^fn_ac_[A-Za-z0-9_-]{43}$/, access: /^fn_at_[A-Za-z0-9_-]{43}$/, refresh: /^fn_rt_[A-Za-z0-9_-]{43}$/ };

/** 32 random bytes as base64url behind a short prefix, so a leaked value is recognizable. Only its hash is stored. */
export function newSecret(kind: SecretKind): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}
export function isSecret(kind: SecretKind, value: string): boolean {
  return SECRET[kind].test(value);
}
export function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A redirect address an app may register: https, or http on a loopback host (RFC 8252), with no fragment or user
 * information. Returns it trimmed, or null when it is not allowed.
 */
export function registrableRedirect(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const value = uri.trim();
  if (value.length === 0 || value.length > 512 || value.includes("#") || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || !url.hostname) return null;
  if (url.protocol === "https:") return value;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return value;
  return null;
}

const isLoopback = (url: URL) => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/**
 * Whether the address in an authorization request is one the app registered: an exact match, or for a loopback
 * address the same scheme, host, path and query on any port (an app on a computer picks its port at run time).
 */
export function redirectAllowed(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  let want: URL;
  try {
    want = new URL(presented);
  } catch {
    return false;
  }
  if (!isLoopback(want) || presented.includes("#")) return false;
  return registered.some((r) => {
    try {
      const have = new URL(r);
      return isLoopback(have) && have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search;
    } catch {
      return false;
    }
  });
}

/** Where an approval would send the person, for the consent page: host and port, as the address says. */
export function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/** True when every address is on this computer, so the consent page can say the app runs locally. */
export function allLoopback(uris: readonly string[]): boolean {
  return uris.length > 0 && uris.every((u) => {
    try {
      return isLoopback(new URL(u));
    } catch {
      return false;
    }
  });
}

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
export const isCodeVerifier = (value: string): boolean => PKCE_VALUE.test(value);
/** An S256 challenge is the 43-character base64url of a SHA-256 hash. */
export const isCodeChallenge = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** PKCE (RFC 7636, S256), compared in constant time. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isCodeVerifier(verifier)) return false;
  const a = Buffer.from(codeChallengeFor(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Adds OAuth response parameters to the app's redirect address, keeping any query it already has. */
export function withParams(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}
