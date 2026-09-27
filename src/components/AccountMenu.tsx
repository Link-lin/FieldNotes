"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { api } from "./api";
import { plural } from "./format";
import { TrashIcon } from "./icons";

type Props = { name: string; email: string; ownedTrips: string[]; viewerCount: number; signOut: () => Promise<void> };

/** ACCESS-10: account menu with sign out and account deletion. */
export function AccountMenu({ name, email, ownedTrips, viewerCount, signOut }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("button")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!menu.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  }

  async function deleteAccount() {
    if (typed !== "DELETE") {
      setError("Type DELETE to confirm.");
      return;
    }
    setBusy(true);
    const r = await api<void>("DELETE", "/api/account", { confirm: "DELETE" });
    setBusy(false);
    if (!r.ok) setError(r.message);
    else {
      router.replace("/sign-in?deleted=1");
      router.refresh();
    }
  }

  return (
    <div className="account">
      <button ref={button} className="avatar" type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        {initials}
      </button>
      <div className="menu" role="menu" ref={menu} hidden={!open} onKeyDown={onMenuKey}>
        <div className="menu-head">
          <b>{name}</b>
          <span>{email}</span>
          <span className="mono">Owner of {plural(ownedTrips.length, "trip")} · viewer of {viewerCount}</span>
        </div>
        <form action={signOut}>
          <button type="submit" role="menuitem">Sign out</button>
        </form>
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => {
            setOpen(false);
            setConfirming(true);
          }}
        >
          <TrashIcon /> Delete my account
        </button>
      </div>
      {confirming ? (
        <Modal
          title="Delete my account"
          onClose={() => setConfirming(false)}
          fallbackFocus={() => button.current}
          subtitle={
            <>
              This signs you out and removes your sign-in identity. Trips shared with you stop being visible to you.
              {ownedTrips.length ? ` It also permanently deletes ${ownedTrips.length === 1 ? "the trip" : `the ${ownedTrips.length} trips`} you own, with their events, booking lists and invitations:` : ""}
            </>
          }
        >
          {ownedTrips.length ? (
            <ul className="warnings">
              {ownedTrips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : null}
          <label className="field">
            Type DELETE to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-invalid={error ? true : undefined} aria-describedby={error ? "acct-err" : undefined} />
          </label>
          {error ? <p className="form-error" id="acct-err" role="alert">{error}</p> : null}
          <div className="pills">
            <button className="pill pill-quiet" type="button" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="pill pill-danger-fill" type="button" onClick={deleteAccount} disabled={busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
