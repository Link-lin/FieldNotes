import "server-only";
import { normalizeEmail, ownerEmails } from "@/server/core/env";
import { emailKey } from "@/shared/email";

/**
 * The signed-in person as the DAL sees them. Built only from a server-validated session. `email` is null for
 * an account that signed in with WeChat only; such a person is never on the owner allowlist.
 */
export type Actor = { userId: string; email: string | null; isOwner: boolean };

export function actorFor(user: { id: string; email: string | null }): Actor {
  if (user.email === null) return { userId: user.id, email: null, isOwner: false };
  const email = normalizeEmail(user.email);
  return { userId: user.id, email, isOwner: ownerEmails().has(emailKey(email)) };
}
