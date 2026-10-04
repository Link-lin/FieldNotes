import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers and a per-request CSP nonce. Not an authorization boundary:
 * every page and Route Handler checks the session and trip access itself.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  // Sign-in redirects to Google and, when set up, to Apple and WeChat. APPLE_ORIGIN and WECHAT_OPEN_ORIGIN point
  // tests at stand-in servers; an unusable override falls back to the provider's own host.
  const hostOf = (override: string | undefined, own: string) => {
    try {
      return new URL(override?.trim() || own).origin;
    } catch {
      return own;
    }
  };
  const signInHosts = ["https://accounts.google.com", hostOf(process.env.APPLE_ORIGIN, "https://appleid.apple.com"), hostOf(process.env.WECHAT_OPEN_ORIGIN, "https://open.weixin.qq.com")];
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // The event side panel embeds Google's Maps Embed API (MAP-8); nothing else may be framed.
    "frame-src https://www.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${signInHosts.join(" ")}`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Where a signed-out visitor returns after sign-in, query included (?view=bookings, ?filter=past).
  requestHeaders.set("x-return-path", request.nextUrl.pathname + request.nextUrl.search);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "private, no-store");
  if (!dev) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return response;
}

export const config = {
  // The site's icons are public images (the AI apps' servers fetch them without signing in) and hold nothing private.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)" }],
};
