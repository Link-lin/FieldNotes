"use client";

import { useRef, useState } from "react";
import { Menu, MenuHeader, MenuItem } from "@/components/ui/Menu/Menu";
import { TrashIcon } from "@/components/ui/Icon/icons";
import { initials, plural } from "@/lib/format";
import { DeleteAccountDialog } from "./DeleteAccountDialog/DeleteAccountDialog";
import styles from "./AccountMenu.module.css";

type Props = { name: string; email: string; ownedCount: number; sharedCount: number; signOut: () => Promise<void> };

/** ACCESS-10: account menu with sign out and account deletion. */
export function AccountMenu({ name, email, ownedCount, sharedCount, signOut }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const avatar = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <Menu
        open={open}
        onOpenChange={setOpen}
        trigger={({ ref, ...props }) => (
          <button
            ref={(el) => {
              ref.current = el;
              avatar.current = el;
            }}
            className={styles.avatar}
            type="button"
            aria-label="Account menu"
            {...props}
          >
            {initials(name)}
          </button>
        )}
      >
        <MenuHeader>
          <b>{name}</b>
          {email ? <span>{email}</span> : null}
          <span className="mono">Owner of {plural(ownedCount, "trip")} · invited to {sharedCount}</span>
        </MenuHeader>
        <form action={signOut}>
          <MenuItem type="submit">Sign out</MenuItem>
        </form>
        <MenuItem
          danger
          icon={<TrashIcon />}
          onClick={() => {
            setOpen(false);
            setConfirming(true);
          }}
        >
          Delete my account
        </MenuItem>
      </Menu>
      {confirming ? <DeleteAccountDialog onClose={() => setConfirming(false)} returnFocus={() => avatar.current} /> : null}
    </>
  );
}
