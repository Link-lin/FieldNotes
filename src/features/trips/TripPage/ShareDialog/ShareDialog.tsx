"use client";

import { useEffect, useRef, useState } from "react";
import type { InvitationDelivery, InvitationDTO, InvitationLinkDTO, Role, TripDetailDTO } from "@/shared/dto";
import { ROLE_HELP, ROLE_LABEL, ROLES } from "@/shared/roles";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { CheckField, Field, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { api } from "@/lib/api";
import { InviteLink } from "./InviteLink/InviteLink";
import { ViewerList, type IssueResult } from "./ViewerList/ViewerList";
import styles from "./ShareDialog.module.css";

type Props = { trip: TripDetailDTO["trip"]; /** Whether the server can email invitations (SMTP is set up). */ canEmail: boolean; onClose: () => void };
/** A link shown once. `name` is the address, or the label of an entry made by link. */
type Shown = { id: string; name: string; byLink: boolean; role: Role; url: string; expiresAt: string; delivery: InvitationDelivery; copied: boolean };
/** What an owner can ask for: a new entry by email or by link, or a new link for an entry made by link. */
type Issue = { kind: "email"; email: string; role: Role } | { kind: "link"; label: string; role: Role } | { kind: "renew"; entry: InvitationDTO };

/** Insert or replace entries by ID, keeping list order. */
function upsert(list: InvitationDTO[], add: InvitationDTO[]): InvitationDTO[] {
  let out = list;
  for (const entry of add) out = out.some((e) => e.id === entry.id) ? out.map((e) => (e.id === entry.id ? entry : e)) : [...out, entry];
  return out;
}

/**
 * ACCESS-3/5/8/11: the Share dialog for owners. It states what each role can see and do before anything is
 * created, invites one person at a time with a role, by email (emailing the link when the server can, and
 * otherwise handing the owner a message to send) or by link (a message the owner sends themselves, for someone
 * without a Google address), shows each new link once (only its hash is stored, so it can't be shown again),
 * and lists the people with their roles, Revoke and a new link.
 */
export function ShareDialog({ trip, canEmail, onClose }: Props) {
  const [entries, setEntries] = useState<InvitationDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Every link created while the dialog is open, newest first. A newer link for the same entry
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
  async function issue(what: Issue): Promise<IssueResult> {
    const r =
      what.kind === "email"
        ? await api<InvitationLinkDTO>("POST", `/api/trips/${trip.id}/invitations`, { email: what.email, role: what.role })
        : what.kind === "link"
          ? await api<InvitationLinkDTO>("POST", `/api/trips/${trip.id}/invitations`, { label: what.label, role: what.role })
          : await api<InvitationLinkDTO>("POST", `/api/trips/${trip.id}/invitations/${what.entry.id}/link`);
    if (!r.ok) {
      const field = r.fields.find((f) => f.path === "email" || f.path === "label");
      return { ok: false, message: field?.message ?? r.message, onField: Boolean(field) };
    }
    const entry = r.data.invitation;
    issuedDuringLoad.current.set(entry.id, entry);
    setEntries((list) => upsert(list ?? [], [entry]));
    // A link that was emailed is already with its recipient, so closing needn't warn that it wasn't copied.
    const link: Shown = {
      id: entry.id,
      name: entry.email ?? entry.label ?? "",
      byLink: entry.email === null,
      role: entry.role,
      url: r.data.invitationUrl,
      expiresAt: r.data.expiresAt,
      delivery: r.data.delivery,
      copied: r.data.delivery === "sent",
    };
    setLinks((all) => [link, ...all.filter((l) => l.id !== entry.id)]);
    setConfirmClose(false);
    return { ok: true };
  }

  /** A new link for an existing entry: sent to its address, or for an entry made by link, shown to copy. */
  const renew = (entry: InvitationDTO) => issue(entry.email !== null ? { kind: "email", email: entry.email, role: entry.role } : { kind: "renew", entry });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);
    const fieldId = mode === "email" ? "share-email" : "share-label";
    if (mode === "email" ? !email.trim() : !label.trim()) {
      setFieldError(mode === "email" ? "Enter the email address of the person you want to invite." : "Give the person a name or note, like Mei on WeChat.");
      document.getElementById(fieldId)?.focus();
      return;
    }
    setCreating(true);
    const r = await issue(mode === "email" ? { kind: "email", email, role } : { kind: "link", label, role });
    setCreating(false);
    if (r.ok) {
      if (mode === "email") setEmail("");
      else setLabel("");
      return;
    }
    if (r.onField) {
      setFieldError(r.message);
      document.getElementById(fieldId)?.focus();
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
    <Modal title="Share this trip" onClose={requestClose} subtitle={canEmail ? "Invite people by email and choose what each can do. They sign in with Google." : "Invite people and choose what each can do. They sign in with Google."} triggerSelector="[data-share-trip]">
      <Banner tone="info">
        <p>
          Everyone you invite can see everything in this trip: all events, place names, map links and exact pinned positions, planned prices, booking
          status and links. You can&apos;t share only part of a trip.
        </p>
        <ul>
          {ROLES.map((r) => <li key={r}><b>{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]}</li>)}
        </ul>
      </Banner>

      <form className={styles.invite} onSubmit={onSubmit} noValidate>
        <fieldset className={styles.mode}>
          <legend className="visually-hidden">How they will join</legend>
          <CheckField type="radio" name="share-mode" checked={mode === "email"} onChange={() => { setMode("email"); setFieldError(null); }} label="By email" />
          <CheckField type="radio" name="share-mode" checked={mode === "link"} onChange={() => { setMode("link"); setFieldError(null); }} label="By link (for example, a WeChat contact)" />
        </fieldset>
        {mode === "email" ? (
          <Field label="Invite by email" htmlFor="share-email" hint="Gmail addresses match even if the dots, a +tag or googlemail.com differ." hintId="share-email-hint" error={fieldError} errorId="share-email-error" className={styles.email}>
            <input
              id="share-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sam@example.com"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "share-email-error" : "share-email-hint"}
            />
          </Field>
        ) : (
          <Field label="Name or note" htmlFor="share-label" hint="Only you see this. For example: Mei, on WeChat." hintId="share-label-hint" error={fieldError} errorId="share-label-error" className={styles.email}>
            <input
              id="share-label"
              type="text"
              autoComplete="off"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Mei, on WeChat"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "share-label-error" : "share-label-hint"}
            />
          </Field>
        )}
        <Field label="Can" htmlFor="share-role" hint={ROLE_HELP[role]} hintId="share-role-hint" className={styles.roleField}>
          <select id="share-role" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-describedby="share-role-hint">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Button variant="fill" type="submit" disabled={creating}>
          {mode === "link" ? (creating ? "Creating…" : "Create link") : creating ? (canEmail ? "Sending…" : "Creating…") : canEmail ? "Send invitation" : "Create invitation"}
        </Button>
      </form>
      {mode === "link" ? (
        <p className="note">
          Whoever opens the link first joins as {ROLE_LABEL[role].toLowerCase()}, whoever they are, so send it only to the person you mean. It works once and
          expires in seven days. You can revoke it afterwards.
        </p>
      ) : null}
      {formError ? <FormError>{formError}</FormError> : null}

      {links.map((l) => (
        <InviteLink
          key={l.url}
          tripTitle={trip.title}
          name={l.name}
          byLink={l.byLink}
          role={l.role}
          url={l.url}
          expiresAt={l.expiresAt}
          delivery={l.delivery}
          onCopied={() => setLinks((all) => all.map((x) => (x.url === l.url ? { ...x, copied: true } : x)))}
        />
      ))}

      <section className={styles.people} aria-labelledby="share-people">
        <h3 id="share-people" className={styles.heading}>People and invitations</h3>
        <p className="note">
          {trip.primaryOwner
            ? "You created this trip and are always an owner."
            : trip.creatorGone
              ? "The person who created this trip has deleted their account. A trip always keeps at least one owner."
              : `${trip.ownerName ?? "Someone else"} created this trip and is always an owner.`}
        </p>
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
            canEmail={canEmail}
            onNewLink={renew}
            onRoleChanged={(entry) => {
              setEntries((list) => upsert(list ?? [], [entry]));
              setLinks((all) => all.map((l) => (l.id === entry.id ? { ...l, role: entry.role } : l)));
            }}
            onRevoked={(id) => {
              // A revoked entry's link no longer works; stop showing it.
              setLinks((all) => all.filter((l) => l.id !== id));
              reload();
            }}
            tripId={trip.id}
          />
        )}
      </section>

      {confirmClose && uncopied.length ? (
        <Banner tone="warn" role="alert" className={styles.closeWarning}>
          <span>
            You haven&apos;t copied the link for {uncopied.map((l) => l.name).join(", ")}. It can&apos;t be shown again; you would need to create a new
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
