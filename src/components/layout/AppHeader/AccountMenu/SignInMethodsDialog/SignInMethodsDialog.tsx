"use client";

import { Button } from "@/components/ui/Button/Button";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { Tag } from "@/components/ui/Tag/Tag";
import styles from "./SignInMethodsDialog.module.css";

/** One way of signing in, whether this account has it, and the action that starts connecting it. */
export type SignInMethod = { name: string; connected: boolean; connect: () => Promise<void> };

/** The ways of signing in the host has set up (Google first), and whether the account has an email address. */
export type SignInMethods = { options: SignInMethod[]; hasEmail: boolean };

/**
 * ACCESS-12: the ways to sign in to this account. Connecting another one adds it to the account you are signed in
 * as, so any of them opens the same account and the same trips; one that already belongs to a different account is
 * refused. Connecting Google (or Apple, sharing the person's own address) gives an account that has no email one, so
 * it can be invited by email, and, if the address is on the owner list, create trips.
 */
export function SignInMethodsDialog({ methods, onClose, returnFocus }: { methods: SignInMethods; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const rows = methods.options;
  const google = rows.some((r) => r.name === "Google" && r.connected);
  const apple = rows.some((r) => r.name === "Apple");
  return (
    <Modal title="Sign-in methods" onClose={onClose} fallbackFocus={returnFocus} subtitle="Connect another way to sign in. Each one opens the same account and the same trips.">
      <ul className={styles.methods}>
        {rows.map((r) => (
          <li key={r.name} className={styles.method}>
            <span className={styles.name}>{r.name}</span>
            {r.connected ? (
              <Tag tone="soft">Connected</Tag>
            ) : (
              <form action={r.connect}>
                <Button variant="outline" type="submit" aria-label={`Connect ${r.name}`}>Connect</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {!methods.hasEmail && !google ? <p className="note">Connecting Google{apple ? ", or Apple with your email shared," : ""} gives this account an email address, so you can be invited by email.</p> : null}
      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}
