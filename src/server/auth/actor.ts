import "server-only";
import { normalizeEmail, ownerEmails } from "@/server/core/env";
import { emailKey } from "@/shared/email";

/** The signed-in person as the DAL sees them. Built only from a server-validated session. */
export type Actor = { userId: string; email: string; isOwner: boolean };

export function actorFor(user: { id: string; email: string }): Actor {
  const email = normalizeEmail(user.email);
  return { userId: user.id, email, isOwner: ownerEmails().has(emailKey(email)) };
}
