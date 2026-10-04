/** Domains whose addresses reach one Google account whatever the dots, "+tag" or domain spelling. */
export const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"] as const;

/**
 * The key that decides whether two addresses belong to the same person, for invitations and the owner
 * allowlist. Gmail ignores dots in the name and everything after the first "+", and googlemail.com is
 * the same mailbox as gmail.com, so `Jane.Doe+trip@googlemail.com` and `janedoe@gmail.com` share a key.
 * Every other domain is compared as typed (trimmed and lowercased), because other providers treat dots
 * and "+" differently and a wrong merge would let one person into another's trip.
 *
 * Matching by this key is safe for Gmail because Google never gives two accounts addresses that differ
 * only by dots, and does not allow "+" in an address. A malformed address is left as typed.
 */
export function emailKey(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return e;
  if (!(GMAIL_DOMAINS as readonly string[]).includes(e.slice(at + 1))) return e;
  const name = e.slice(0, at).split("+")[0]!.replaceAll(".", "");
  return name ? `${name}@gmail.com` : e;
}
