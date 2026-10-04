import "server-only";

/** The claims a sign-in returns that bear on the email address (Google and Apple use these names). */
export type EmailClaims = { email?: unknown; email_verified?: unknown; is_private_email?: unknown };

/** Apple sends its booleans as `true` or as the string "true". */
const isTrue = (value: unknown): boolean => value === true || value === "true";

/** The domain of the relay addresses Apple gives someone who chooses Hide My Email. */
const APPLE_RELAY = /@privaterelay\.appleid\.com$/i;

/**
 * The email address a sign-in proves its owner controls (ACCESS-1), or null when there is none to rely on. Google's
 * must be marked verified. Apple's must be too, and must be the person's own: a relay address reaches them but names
 * no one and matches nothing, so it counts as no address. WeChat gives none.
 */
export function verifiedEmail(provider: string | undefined, claims: EmailClaims): string | null {
  const { email } = claims;
  if (typeof email !== "string" || email.trim() === "") return null;
  if (provider === "google") return claims.email_verified === true ? email : null;
  if (provider === "apple") return isTrue(claims.email_verified) && !isTrue(claims.is_private_email) && !APPLE_RELAY.test(email.trim()) ? email : null;
  return null;
}
