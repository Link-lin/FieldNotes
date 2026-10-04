import "server-only";

const CALLBACK_PATH = "/api/auth/callback/apple";
/** Added to the address the page posts back to, so that second request goes to Auth.js and is not bounced again. */
const MARKER = "bounce";
/** What Apple posts is a code, a token, a state and a name: far below this. */
const MAX_BODY = 16 * 1024;

/** The request's body as text, or null once it passes `max` bytes (reading stops there, whatever it declared). */
async function readText(request: Request, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Apple answers a sign-in by posting the result to `/api/auth/callback/apple` from its own page. Browsers don't send
 * `SameSite=Lax` cookies with a cross-site POST, so Auth.js would see neither the session (needed to connect Apple to
 * a signed-in account), nor the invitation staging cookie, nor where to go afterwards. Only the state and nonce
 * cookies come, because Auth.js sets those `SameSite=None` for a form post.
 *
 * So the first POST is answered with a page that holds the same fields and posts them straight back to the same
 * address, marked. The browser counts that request as coming from this site and sends every cookie, and Auth.js
 * then sees an ordinary callback. Nothing is kept or logged in between. A request that already carries the marker
 * (or isn't Apple's POST) returns null and goes to Auth.js; sending one from another site gains nothing, since the
 * state cookie still has to match.
 */
export async function appleReturn(request: Request, nonce: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== CALLBACK_PATH || url.searchParams.has(MARKER)) return null;
  const tooLarge = () => new Response("Request too large", { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return tooLarge();
  const body = await readText(request, MAX_BODY);
  if (body === null) return tooLarge();
  const fields = [...new URLSearchParams(body)].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
  const attr = nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Signing in</title>
<style${attr}>body{display:grid;place-items:center;min-height:100vh;margin:0;font:16px/1.5 system-ui,sans-serif;text-align:center}button{font:inherit;padding:.5em 1.1em}</style></head>
<body><main><p>Signing you in…</p><form method="post" action="${CALLBACK_PATH}?${MARKER}=1">${fields}<button type="submit">Continue</button></form></main>
<script${attr}>document.forms[0].submit()</script></body></html>`;
  return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
