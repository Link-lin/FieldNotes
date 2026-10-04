"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { ROLE_LABEL, ROLE_YOU_CAN } from "@/shared/roles";
import { CopyIcon } from "@/components/ui/Icon/icons";
import type { InvitationDelivery, Role } from "@/shared/dto";
import { instantDate } from "@/lib/format";
import styles from "./InviteLink.module.css";

type Props = { tripTitle: string; email: string; role: Role; url: string; expiresAt: string };
type LinkProps = Props & {
  /** Whether the server emailed the invitation. When it didn't (off or failed), the owner sends the message. */
  delivery: InvitationDelivery;
  /** Called when the message is copied, by the button or by the keyboard. */
  onCopied: () => void;
};

export function inviteMessage({ tripTitle, email, role, url, expiresAt }: Props): string {
  return [
    `I've shared my trip "${tripTitle}" with you on Field Notes. ${ROLE_YOU_CAN[role]}`,
    "",
    `Open this link and sign in with Google as ${email}:`,
    url,
    "",
    `The link works for one Google account and expires on ${instantDate(expiresAt)}.`,
  ].join("\n");
}

/**
 * ACCESS-3/11: the new link, shown once in the dialog that created it. Only its hash is stored, so it
 * can't be shown again; losing it means creating a new link. When the server emailed the invitation, the
 * dialog says so and keeps the message to copy tucked away; when email is off or failed, copying the
 * message is how the owner delivers the invitation.
 */
export function InviteLink({ onCopied, delivery, ...props }: LinkProps) {
  const message = inviteMessage(props);
  const id = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const text = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const sent = delivery === "sent";
  const role = ROLE_LABEL[props.role].toLowerCase();
  const expires = instantDate(props.expiresAt);

  useEffect(() => {
    // Put focus on Copy so the keyboard path continues from the new link. An emailed invitation has nothing
    // to copy first, so focus moves to the result instead and a screen reader reads it out.
    (sent ? box.current : box.current?.querySelector<HTMLElement>("[data-copy-invite]"))?.focus();
  }, [sent]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("copied");
      onCopied();
    } catch {
      text.current?.select();
      setCopied("manual");
    }
  }

  const copyMessage = (
    <>
      <Field label="Message to send" htmlFor={`${id}-message`}>
        <textarea
          id={`${id}-message`}
          ref={text}
          className={styles.message}
          readOnly
          rows={7}
          value={message}
          onFocus={(e) => e.currentTarget.select()}
          onCopy={onCopied}
        />
      </Field>
      <div className={styles.row}>
        <Button data-copy-invite onClick={() => void copy()}><CopyIcon /> Copy message</Button>
        <span role="status" className="muted">{copied === "copied" ? "Copied." : copied === "manual" ? "Couldn't copy automatically. The message is selected; copy it with your keyboard." : ""}</span>
      </div>
    </>
  );

  return (
    <div ref={box} className={styles.box} role="group" aria-labelledby={`${id}-title`} tabIndex={sent ? -1 : undefined} data-invite-link data-delivery={delivery}>
      <p id={`${id}-title`} className={styles.title}>{sent ? "Invitation emailed to" : "Invitation for"} {props.email} as {role}</p>
      {delivery === "failed" ? (
        <Banner tone="warn" role="alert">The email couldn&apos;t be sent, but the invitation is saved. Copy the message below and send it yourself.</Banner>
      ) : null}
      {sent ? (
        <>
          <p className="note">
            The link in it works for one Google account and expires on {expires}. If it doesn&apos;t arrive, ask them to check their spam folder, or send
            a new link from the list below.
          </p>
          <details className={styles.fallback}>
            <summary>Copy the message to send it yourself</summary>
            <div className={styles.fallbackBody}>{copyMessage}</div>
          </details>
        </>
      ) : (
        <>
          <p className="note">
            {delivery === "off" ? "This server isn't set up to send email, so copy this message and send it yourself. " : ""}This is the only time the
            link is shown. It expires on {expires}.
          </p>
          {copyMessage}
        </>
      )}
    </div>
  );
}
