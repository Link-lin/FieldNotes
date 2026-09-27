/**
 * Returns a same-origin path for post-sign-in redirects, or "/".
 * Rejects absolute URLs, protocol-relative paths, backslashes (browsers treat "/\\x" as "//x")
 * and control characters, then re-checks by resolving against a fixed origin.
 */
export function safePath(p: string | undefined | null): string {
  if (!p || typeof p !== "string" || p.length > 2048) return "/";
  if (!p.startsWith("/") || p.startsWith("//")) return "/";
  if (p.includes("\\") || /[\u0000-\u001f\u007f]/.test(p)) return "/";
  try {
    const base = "http://fieldnotes.invalid";
    const u = new URL(p, base);
    if (u.origin !== base) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
