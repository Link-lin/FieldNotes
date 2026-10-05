import type { Role } from "@/shared/dto";
import { ROLE_LABEL, ROLE_YOU_CAN } from "@/shared/roles";

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

// The app's paper, ink and vermilion (src/styles/tokens.css), and font stacks that need nothing loaded: mail clients
// drop web fonts or fetch them from elsewhere, and this email loads nothing.
const C = { page: "#f3ecdb", card: "#fffdf6", line: "#e4d9bf", perforation: "#cbbd9c", ink: "#3a3026", ink2: "#675c4c", ink3: "#766a55", ctl: "#8e8066", accent: "#de4f2a", accentInk: "#a63615" };
const SERIF = "'Source Serif 4','Source Serif Pro',Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono','SFMono-Regular',Menlo,Consolas,monospace";

/** One field of the ticket: a small spaced label over its value. Both already escaped. */
const field = (label: string, value: string, side: "left" | "right") => `
<td class="fn-col" width="50%" valign="top" style="padding:18px ${side === "left" ? "14px" : "0"} 0 0;">
  <p style="margin:0 0 6px;font-family:${MONO};font-size:10px;line-height:1.4;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${C.ctl};">${label}</p>
  <p style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.35;color:${C.ink};word-break:break-word;">${value}</p>
</td>`;

/**
 * The email an owner's invitation sends (ACCESS-3). It names the trip, the inviter and what the role allows,
 * and carries the single-use link; it holds no other trip content. The trip title and name are user text, so
 * they are cleaned of control characters and escaped in the HTML part. No images, no web fonts, no tracking: the
 * HTML is tables with inline styles in the app's colours, which every mail client shows the same way.
 */
export function invitationEmail(input: InvitationEmailInput): { subject: string; text: string; html: string } {
  const title = oneLine(input.tripTitle);
  const who = oneLine(input.inviterName);
  // The recipient's time zone is unknown, so the date is stated in UTC.
  const expires = `${day(input.expiresAt)} (UTC)`;
  const can = ROLE_YOU_CAN[input.role];
  const role = ROLE_LABEL[input.role];
  const subject = `${who} shared \u201c${title}\u201d with you on Field Notes`;

  const text = [
    `${who} shared a trip with you on Field Notes.`,
    "",
    `    ${title}`,
    "",
    can,
    "",
    `    Invited by     ${who}`,
    `    Your role      ${role}`,
    `    Sign in as     ${input.inviteeEmail} (with Google)`,
    `    Link expires   ${expires}`,
    "",
    "Open the trip:",
    input.url,
    "",
    "The link works for one Google account. If you weren't expecting this, you can ignore this email.",
    "",
    "Field Notes, a private trip planner",
  ].join("\n");

  const [t, w, e, u] = [escapeHtml(title), escapeHtml(who), escapeHtml(input.inviteeEmail), escapeHtml(input.url)];
  const preview = `${w} shared it with you. Open it and sign in with Google as ${e}.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${escapeHtml(subject)}</title>
<style>
  @media (max-width: 480px) {
    .fn-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .fn-title { font-size: 28px !important; }
    .fn-col { display: block !important; width: 100% !important; padding-right: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preview}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:36px 12px 40px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
  <tr><td style="padding:0 8px 16px;font-family:${MONO};font-size:11px;line-height:1;font-weight:500;letter-spacing:3px;text-transform:uppercase;color:${C.ink2};">
    <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${C.accent};margin-right:10px;vertical-align:0;"></span>Field Notes
  </td></tr>
  <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:20px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td class="fn-pad" style="padding:38px 44px 0;">
        <p style="margin:0 0 16px;font-family:${MONO};font-size:11px;line-height:1.4;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:${C.accentInk};">A trip, shared with you</p>
        <h1 class="fn-title" style="margin:0 0 16px;font-family:${SERIF};font-size:34px;line-height:1.12;font-weight:700;letter-spacing:-0.3px;color:${C.ink};">${t}</h1>
        <p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.ink2};"><strong style="color:${C.ink};font-weight:600;">${w}</strong> shared this trip with you on Field Notes. ${escapeHtml(can)}</p>
      </td></tr>
      <tr><td class="fn-pad" style="padding:30px 44px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px dashed ${C.perforation};">
          <tr>${field("Invited by", w, "left")}${field("Your role", escapeHtml(role), "right")}</tr>
          <tr>${field("Sign in with Google as", e, "left")}${field("Link expires", expires, "right")}</tr>
        </table>
      </td></tr>
      <tr><td class="fn-pad" style="padding:32px 44px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td bgcolor="${C.ink}" style="border-radius:999px;">
            <a href="${u}" style="display:inline-block;padding:15px 30px;border-radius:999px;font-family:${SANS};font-size:16px;line-height:1;font-weight:600;color:${C.card};text-decoration:none;">Open the trip&nbsp;&rarr;</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td class="fn-pad" style="padding:20px 44px 38px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.ink3};">
        Or open this link in your browser:<br>
        <a href="${u}" style="font-family:${MONO};font-size:12px;color:${C.accentInk};text-decoration:none;word-break:break-all;">${u}</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 20px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.ink3};text-align:center;">
    The link works for one Google account.<br>If you weren&rsquo;t expecting this, you can ignore this email.
  </td></tr>
  <tr><td style="padding:16px 20px 0;font-family:${MONO};font-size:10px;line-height:1;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${C.ctl};text-align:center;">Field Notes &middot; a private trip planner</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}
