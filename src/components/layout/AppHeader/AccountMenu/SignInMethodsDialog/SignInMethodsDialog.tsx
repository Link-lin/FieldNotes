"use client";

import { Button } from "@/components/ui/Button/Button";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { Tag } from "@/components/ui/Tag/Tag";
import styles from "./SignInMethodsDialog.module.css";

/** Which ways of signing in this account has, and the actions that connect the missing ones. */
export type SignInMethods = {
  google: boolean;
  wechat: boolean;
  /** Start connecting a Google account to this one. */
  connectGoogle: () => Promise<void>;
  /** Start connecting a WeChat account to this one. */
  connectWeChat: () => Promise<void>;
  /** Whether the account has an email address, which Google gives it. */
  hasEmail: boolean;
};

/**
 * ACCESS-12: the ways to sign in to this account. Connecting another one adds it to the account you are signed in
 * as, so either opens the same account and the same trips; one that already belongs to a different account is
 * refused. Connecting Google gives an account that signed in with WeChat an email address, so it can be invited by
 * email, and, if the address is on the owner list, create trips.
 */
export function SignInMethodsDialog({ methods, onClose, returnFocus }: { methods: SignInMethods; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const rows = [
    { name: "Google", connected: methods.google, connect: methods.connectGoogle },
    { name: "WeChat", connected: methods.wechat, connect: methods.connectWeChat },
  ];
  return (
    <Modal title="Sign-in methods" onClose={onClose} fallbackFocus={returnFocus} subtitle="Connect another way to sign in. Either one opens the same account and the same trips.">
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
      {!methods.hasEmail && !methods.google ? <p className="note">Connecting Google gives this account an email address, so you can be invited by email.</p> : null}
      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}
