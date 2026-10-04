"use client";

import { useRef, useState } from "react";
import { Menu, MenuHeader, MenuItem } from "@/components/ui/Menu/Menu";
import { TrashIcon } from "@/components/ui/Icon/icons";
import { plural } from "@/lib/format";
import { DeleteAccountDialog } from "./DeleteAccountDialog/DeleteAccountDialog";
import styles from "./AccountMenu.module.css";

type Props = { name: string; email: string; ownedTrips: string[]; sharedCount: number; signOut: () => Promise<void> };

/** ACCESS-10: account menu with sign out and account deletion. */
export function AccountMenu({ name, email, ownedTrips, sharedCount, signOut }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const avatar = useRef<HTMLButtonElement | null>(null);
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

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
            {initials}
          </button>
        )}
      >
        <MenuHeader>
          <b>{name}</b>
          <span>{email}</span>
          <span className="mono">Owner of {plural(ownedTrips.length, "trip")} · invited to {sharedCount}</span>
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
      {confirming ? <DeleteAccountDialog ownedTrips={ownedTrips} onClose={() => setConfirming(false)} returnFocus={() => avatar.current} /> : null}
    </>
  );
}
