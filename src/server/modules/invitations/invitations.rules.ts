import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { InvitationStatus } from "@/shared/dto";

/** An invitation link is valid for seven days from issue (ACCESS-3). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The staged invitation survives the Google sign-in round trip for 15 minutes. */
export const STAGE_TTL_SECONDS = 15 * 60;

/** 32 random bytes, base64url: 43 characters with 256 bits of randomness. */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function isInvitationToken(token: string): boolean {
  return TOKEN.test(token);
}

/** Only this SHA-256 hash is stored or placed in the staging cookie; the raw token never is. */
export function hashInvitationToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function invitationStatus(row: { status: "pending" | "accepted" | "revoked"; expires_at: Date | null }, now: Date): InvitationStatus {
  if (row.status === "pending" && (!row.expires_at || row.expires_at.getTime() <= now.getTime())) return "expired";
  return row.status;
}

/**
 * The staging cookie holds the token hash only. `__Host-` (Secure, Path=/, no Domain) on HTTPS;
 * a plain name on http://localhost during development, where browsers drop Secure cookies.
 */
export function stageCookieName(origin: string): string {
  return origin.startsWith("https:") ? "__Host-fieldnotes-invite" : "fieldnotes-invite";
}

export function stageCookie(origin: string, hash: Buffer): string {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${stageCookieName(origin)}=${hash.toString("hex")}; Path=/; Max-Age=${STAGE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearStageCookie(origin: string): string {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${stageCookieName(origin)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** Reads the staged hash from a Cookie header; anything that is not a 32-byte hex value is ignored. */
export function stagedHash(origin: string, cookieHeader: string | null): Buffer | null {
  if (!cookieHeader) return null;
  const name = stageCookieName(origin);
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return /^[0-9a-f]{64}$/.test(value) ? Buffer.from(value, "hex") : null;
  }
  return null;
}
