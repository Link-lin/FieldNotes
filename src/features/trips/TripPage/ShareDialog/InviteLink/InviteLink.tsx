"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { ROLE_LABEL } from "@/shared/roles";
import { CopyIcon } from "@/components/ui/Icon/icons";
import type { Role } from "@/shared/dto";
import { instantDate } from "@/lib/format";
import styles from "./InviteLink.module.css";

type Props = { tripTitle: string; email: string; role: Role; url: string; expiresAt: string };
type LinkProps = Props & { /** Called when the message is copied, by the button or by the keyboard. */ onCopied: () => void };

const WHAT_YOU_CAN_DO: Record<Role, string> = {
  viewer: "You can view it but not change it.",
  editor: "You can view it and change its events, bookings and notes.",
  owner: "You can view it, change it, share it and delete it.",
};

export function inviteMessage({ tripTitle, email, role, url, expiresAt }: Props): string {
  return [
    `I've shared my trip "${tripTitle}" with you on Field Notes. ${WHAT_YOU_CAN_DO[role]}`,
    "",
    `Open this link and sign in with Google as ${email}:`,
    url,
    "",
    `The link works for one Google account and expires on ${instantDate(expiresAt)}.`,
  ].join("\n");
}

/**
 * ACCESS-3/11: the new link, shown once in the dialog that created it. Only its hash is stored, so
 * it can't be shown again; losing it means creating a new link. Field Notes sends no email.
 */
export function InviteLink({ onCopied, ...props }: LinkProps) {
  const message = inviteMessage(props);
  const id = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const text = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Put focus on Copy so the keyboard path continues from the new link.
    box.current?.querySelector<HTMLElement>("[data-copy-invite]")?.focus();
  }, []);

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

  return (
    <div ref={box} className={styles.box} role="group" aria-labelledby={`${id}-title`} data-invite-link>
      <p id={`${id}-title`} className={styles.title}>Invitation for {props.email} as {ROLE_LABEL[props.role].toLowerCase()}</p>
      <p className="note">
        Copy this message and send it yourself; Field Notes doesn&apos;t send email. This is the only time the link is shown. It expires on{" "}
        {instantDate(props.expiresAt)}.
      </p>
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
    </div>
  );
}
