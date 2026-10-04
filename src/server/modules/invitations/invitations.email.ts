import type { Role } from "@/shared/dto";
import { ROLE_YOU_CAN } from "@/shared/roles";

export type InvitationEmailInput = {
  tripTitle: string;
  /** Who is sharing the trip: shown in the subject and the first line. */
  inviterName: string;
  inviteeEmail: string;
  role: Role;
  url: string;
  expiresAt: Date;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
/** A header or one-line value: control characters (a newline would start a new header) become spaces. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The email an owner's invitation sends (ACCESS-3). It names the trip, the inviter and what the role allows,
 * and carries the single-use link; it holds no other trip content. The trip title and name are user text, so
 * they are cleaned of control characters and escaped in the HTML part. No images, no tracking.
 */
export function invitationEmail(input: InvitationEmailInput): { subject: string; text: string; html: string } {
  const title = oneLine(input.tripTitle);
  const who = oneLine(input.inviterName);
  // The recipient's time zone is unknown, so the date is stated in UTC.
  const expires = `${day(input.expiresAt)} (UTC)`;
  const can = ROLE_YOU_CAN[input.role];
  const text = [
    `${who} shared the trip "${title}" with you on Field Notes. ${can}`,
    "",
    `Open this link and sign in with Google as ${input.inviteeEmail}:`,
    input.url,
    "",
    `The link works for one Google account and expires on ${expires}.`,
    "",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = [
    '<div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #3a3026; max-width: 560px;">',
    `<p><strong>${escapeHtml(who)}</strong> shared the trip <strong>&ldquo;${escapeHtml(title)}&rdquo;</strong> with you on Field Notes. ${escapeHtml(can)}</p>`,
    `<p>Open this link and sign in with Google as <strong>${escapeHtml(input.inviteeEmail)}</strong>:</p>`,
    `<p><a href="${escapeHtml(input.url)}" style="display: inline-block; padding: 10px 18px; border-radius: 999px; background: #3a3026; color: #faf5e8; text-decoration: none;">Open the trip</a></p>`,
    `<p style="font-size: 14px; color: #675c4c;">If the button doesn&rsquo;t work, copy this address into your browser:<br>${escapeHtml(input.url)}</p>`,
    `<p style="font-size: 14px; color: #675c4c;">The link works for one Google account and expires on ${expires}. If you weren&rsquo;t expecting this, you can ignore this email.</p>`,
    "</div>",
  ].join("\n");
  return { subject: `${who} shared "${title}" with you on Field Notes`, text, html };
}
