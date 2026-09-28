"use client";

import { useEffect, useState } from "react";
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
type Shown = { email: string; url: string; expiresAt: string };

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
  const [shown, setShown] = useState<Shown | null>(null);

  // Bumped to load the list again (after a revoke, or Try again).
  const [loads, setLoads] = useState(0);
  const reload = () => {
    setLoadError(null);
    setLoads((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    void api<InvitationDTO[]>("GET", `/api/trips/${trip.id}/invitations`).then((r) => {
      if (!live) return;
      if (r.ok) setEntries(r.data);
      else setLoadError(r.message);
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
    setEntries((list) => {
      const all = list ?? [];
      return all.some((e) => e.id === entry.id) ? all.map((e) => (e.id === entry.id ? entry : e)) : [...all, entry];
    });
    setShown({ email: r.data.invitation.email, url: r.data.invitationUrl, expiresAt: r.data.expiresAt });
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

  return (
    <Modal title="Share this trip" onClose={onClose} subtitle="Invite people to view this trip. They sign in with Google and can't make changes." triggerSelector="[data-share-trip]">
      <Banner tone="info">
        Viewers can see everything in this trip: all events, place names, map links and exact pinned positions, planned prices, booking status and
        links. You can&apos;t share only part of a trip.
      </Banner>

      <form className={styles.invite} onSubmit={onSubmit} noValidate>
        <Field label="Invite by email" htmlFor="share-email" error={emailError} errorId="share-email-error" className={styles.email}>
          <input
            id="share-email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sam@example.com"
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "share-email-error" : undefined}
          />
        </Field>
        <Button variant="fill" type="submit" disabled={creating}>{creating ? "Creating…" : "Create invitation"}</Button>
      </form>
      {formError ? <FormError>{formError}</FormError> : null}

      {shown ? <InviteLink key={shown.url} tripTitle={trip.title} {...shown} /> : null}

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
              const entry = entries.find((e) => e.id === id);
              if (entry && shown?.email === entry.email) setShown(null);
              reload();
            }}
            tripId={trip.id}
          />
        )}
      </section>

      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}
