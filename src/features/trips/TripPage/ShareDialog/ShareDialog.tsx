"use client";

import { useEffect, useRef, useState } from "react";
import type { InvitationDTO, InvitationLinkDTO, TripDetailDTO } from "@/shared/dto";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { api } from "@/lib/api";
import { InviteLink } from "./InviteLink/InviteLink";
import { ViewerList, type IssueResult } from "./ViewerList/ViewerList";
import styles from "./ShareDialog.module.css";

type Props = { trip: TripDetailDTO["trip"]; onClose: () => void };
type Shown = { email: string; url: string; expiresAt: string; copied: boolean };

/** Insert or replace entries by ID, keeping list order. */
function upsert(list: InvitationDTO[], add: InvitationDTO[]): InvitationDTO[] {
  let out = list;
  for (const entry of add) out = out.some((e) => e.id === entry.id) ? out.map((e) => (e.id === entry.id ? entry : e)) : [...out, entry];
  return out;
}

/**
 * ACCESS-8/11: the owner's Share dialog. It states what viewers can see before anything is created,
 * invites one email at a time, shows each new link once (only its hash is stored, so it can't be
 * shown again), and lists viewers and invitations with Revoke and Create new link.
 */
export function ShareDialog({ trip, onClose }: Props) {
  const [entries, setEntries] = useState<InvitationDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Every link created while the dialog is open, newest first. A newer link for the same email
  // replaces the older one, which no longer works anyway.
  const [links, setLinks] = useState<Shown[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Entries created while a list load is in flight, so a slower, older list can't drop them.
  const issuedDuringLoad = useRef(new Map<string, InvitationDTO>());

  // Bumped to load the list again (after a revoke, or Try again).
  const [loads, setLoads] = useState(0);
  const reload = () => {
    setLoadError(null);
    setLoads((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    const issued = issuedDuringLoad.current;
    issued.clear();
    void api<InvitationDTO[]>("GET", `/api/trips/${trip.id}/invitations`).then((r) => {
      if (!live) return;
      if (r.ok) setEntries(upsert(r.data, [...issued.values()]));
      else setLoadError(r.message);
      issued.clear();
    });
    return () => {
      live = false;
    };
  }, [trip.id, loads]);

  /** Create an invitation, or a new link for an existing entry, and show the link once. */
  async function issue(address: string): Promise<IssueResult> {
    const r = await api<InvitationLinkDTO>("POST", `/api/trips/${trip.id}/invitations`, { email: address });
    if (!r.ok) {
      const field = r.fields.find((f) => f.path === "email");
      return { ok: false, message: field?.message ?? r.message, onEmail: Boolean(field) };
    }
    const entry = r.data.invitation;
    issuedDuringLoad.current.set(entry.id, entry);
    setEntries((list) => upsert(list ?? [], [entry]));
    const link = { email: entry.email, url: r.data.invitationUrl, expiresAt: r.data.expiresAt, copied: false };
    setLinks((all) => [link, ...all.filter((l) => l.email !== entry.email)]);
    setConfirmClose(false);
    return { ok: true };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setFormError(null);
    if (!email.trim()) {
      setEmailError("Enter the email address of the person you want to invite.");
      document.getElementById("share-email")?.focus();
      return;
    }
    setCreating(true);
    const r = await issue(email);
    setCreating(false);
    if (r.ok) {
      setEmail("");
      return;
    }
    if (r.onEmail) {
      setEmailError(r.message);
      document.getElementById("share-email")?.focus();
    } else setFormError(r.message);
  }

  const uncopied = links.filter((l) => !l.copied);

  /** A link is shown only once, so closing with an uncopied link asks first; asking twice closes. */
  function requestClose() {
    if (uncopied.length && !confirmClose) setConfirmClose(true);
    else onClose();
  }

  useEffect(() => {
    if (confirmClose) document.querySelector<HTMLElement>("[data-close-anyway]")?.focus();
  }, [confirmClose]);

  return (
    <Modal title="Share this trip" onClose={requestClose} subtitle="Invite people to view this trip. They sign in with Google and can't make changes." triggerSelector="[data-share-trip]">
      <Banner tone="info">
        Viewers can see everything in this trip: all events, place names, map links and exact pinned positions, planned prices, booking status and
        links. You can&apos;t share only part of a trip.
      </Banner>

      <form className={styles.invite} onSubmit={onSubmit} noValidate>
        <Field label="Invite by email" htmlFor="share-email" hint="Gmail addresses match even if the dots, a +tag or googlemail.com differ." hintId="share-email-hint" error={emailError} errorId="share-email-error" className={styles.email}>
          <input
            id="share-email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sam@example.com"
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "share-email-error" : "share-email-hint"}
          />
        </Field>
        <Button variant="fill" type="submit" disabled={creating}>{creating ? "Creating…" : "Create invitation"}</Button>
      </form>
      {formError ? <FormError>{formError}</FormError> : null}

      {links.map((l) => (
        <InviteLink
          key={l.url}
          tripTitle={trip.title}
          email={l.email}
          url={l.url}
          expiresAt={l.expiresAt}
          onCopied={() => setLinks((all) => all.map((x) => (x.url === l.url ? { ...x, copied: true } : x)))}
        />
      ))}

      <section className={styles.people} aria-labelledby="share-people">
        <h3 id="share-people" className={styles.heading}>Viewers and invitations</h3>
        {loadError ? (
          <div className={styles.loadError}>
            <FormError>{loadError}</FormError>
            <Button variant="quiet" onClick={reload}>Try again</Button>
          </div>
        ) : entries === null ? (
          <p className="muted" role="status">Loading…</p>
        ) : (
          <ViewerList
            entries={entries}
            onNewLink={issue}
            onRevoked={(id) => {
              // A revoked entry's link no longer works; stop showing it.
              const entry = entries.find((e) => e.id === id);
              if (entry) setLinks((all) => all.filter((l) => l.email !== entry.email));
              reload();
            }}
            tripId={trip.id}
          />
        )}
      </section>

      {confirmClose && uncopied.length ? (
        <Banner tone="warn" role="alert" className={styles.closeWarning}>
          <span>
            You haven&apos;t copied the link for {uncopied.map((l) => l.email).join(", ")}. It can&apos;t be shown again; you would need to create a new
            link.
          </span>
          <span className={styles.closeActions}>
            <Button variant="quiet" onClick={() => setConfirmClose(false)}>Keep open</Button>
            <Button variant="danger" data-close-anyway onClick={onClose}>Close anyway</Button>
          </span>
        </Banner>
      ) : null}

      <ModalActions>
        <Button variant="quiet" onClick={requestClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}
