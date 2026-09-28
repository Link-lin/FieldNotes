"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { Field } from "@/components/ui/Field/Field";
import { CopyIcon } from "@/components/ui/Icon/icons";
import { instantDate } from "@/lib/format";
import styles from "./InviteLink.module.css";

type Props = { tripTitle: string; email: string; url: string; expiresAt: string };

export function inviteMessage({ tripTitle, email, url, expiresAt }: Props): string {
  return [
    `I've shared my trip "${tripTitle}" with you on Field Notes. You can view it but not change it.`,
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
export function InviteLink(props: Props) {
  const message = inviteMessage(props);
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Put focus on Copy so the keyboard path continues from the new link.
    document.querySelector<HTMLElement>("[data-copy-invite]")?.focus();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("copied");
    } catch {
      text.current?.select();
      setCopied("manual");
    }
  }

  return (
    <div className={styles.box} role="group" aria-labelledby="invite-link-title" data-invite-link>
      <p id="invite-link-title" className={styles.title}>Invitation for {props.email}</p>
      <p className="note">
        Copy this message and send it yourself; Field Notes doesn&apos;t send email. This is the only time the link is shown. It expires on{" "}
        {instantDate(props.expiresAt)}.
      </p>
      <Field label="Message to send" htmlFor="invite-message">
        <textarea id="invite-message" ref={text} className={styles.message} readOnly rows={7} value={message} onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <div className={styles.row}>
        <Button data-copy-invite onClick={() => void copy()}><CopyIcon /> Copy message</Button>
        <span role="status" className="muted">{copied === "copied" ? "Copied." : copied === "manual" ? "Couldn't copy automatically. The message is selected; copy it with your keyboard." : ""}</span>
      </div>
    </div>
  );
}
