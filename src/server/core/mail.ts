import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

export type MailMessage = { to: string; subject: string; text: string; html: string; replyTo?: string };

/** Email is on only when both the SMTP server and the sender address are set (SMTP_URL and MAIL_FROM). */
export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL?.trim() && process.env.MAIL_FROM?.trim());
}

const globalForMail = globalThis as unknown as { __fnMail?: { url: string; transport: Transporter } };

/**
 * One transport per SMTP_URL, with short timeouts so an unreachable mail server fails a request in
 * seconds instead of hanging it (the library's own defaults are minutes).
 */
function transport(): Transporter {
  const url = process.env.SMTP_URL!.trim();
  if (globalForMail.__fnMail?.url !== url) {
    globalForMail.__fnMail = { url, transport: nodemailer.createTransport({ url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }) };
  }
  return globalForMail.__fnMail.transport;
}

/**
 * Sends one message through the configured SMTP server and resolves once the server accepts it, which
 * is not proof the recipient received it. Throws when email is not configured or the server refuses.
 * Callers log the error class only, never an address, a subject or a body.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!mailConfigured()) throw new Error("Email is not configured");
  await transport().sendMail({
    from: process.env.MAIL_FROM!.trim(),
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
