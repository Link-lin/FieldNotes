"use client";

import { useEffect, useRef, useState } from "react";
import type { InvitationDTO, InvitationStatus, Role } from "@/shared/dto";
import { ROLE_HELP, ROLE_LABEL, ROLES } from "@/shared/roles";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Tag } from "@/components/ui/Tag/Tag";
import { api } from "@/lib/api";
import { instantDate } from "@/lib/format";
import styles from "./ViewerList.module.css";

/** The outcome of asking for a new link; the parent shows the link itself. */
export type IssueResult = { ok: true } | { ok: false; message: string; onEmail: boolean };

type Props = {
  tripId: string;
  entries: InvitationDTO[];
  /** With email set up, a new link is emailed ("Send new link"); without it the owner copies it. */
  canEmail: boolean;
  onNewLink: (email: string, role: Role) => Promise<IssueResult>;
  onRoleChanged: (entry: InvitationDTO) => void;
  onRevoked: (id: string) => void;
};

/** The status tag. An accepted person shows their role instead; the role picker beside it changes it. */
const LABEL: Record<InvitationStatus, string> = { pending: "Invited", accepted: "Has access", expired: "Link expired", revoked: "Revoked" };

function detail(e: InvitationDTO): string {
  if (e.status === "pending") return e.expiresAt ? `Link expires ${instantDate(e.expiresAt)}` : "";
  if (e.status === "expired") return e.expiresAt ? `Link expired ${instantDate(e.expiresAt)}` : "";
  if (e.status === "accepted") return e.acceptedAt ? `Joined ${instantDate(e.acceptedAt)}` : "";
  return e.revokedAt ? `Access revoked ${instantDate(e.revokedAt)}` : "Access revoked";
}

/**
 * ACCESS-5/6/11: the people a trip is shared with and their invitations, with status, role and expiry.
 * An owner changes anyone's role here (promoting to owner asks first). Revoke is offered for pending and
 * accepted entries (an accepted person is asked to confirm); a new link (emailed when the server can) for
 * pending, expired and revoked entries, and it invalidates any earlier link.
 */
export function ViewerList({ tripId, entries, canEmail, onNewLink, onRoleChanged, onRevoked }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  // After a revoke the row's buttons change; keep focus in that row once the list reloads.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    if (confirming) document.querySelector<HTMLElement>(`[data-confirm-revoke="${confirming}"]`)?.focus();
  }, [confirming]);

  useEffect(() => {
    if (promoting) document.querySelector<HTMLElement>(`[data-confirm-promote="${promoting}"]`)?.focus();
  }, [promoting]);

  useEffect(() => {
    const id = refocus.current;
    const target = id ? document.querySelector<HTMLElement>(`[data-entry="${id}"] button:not([disabled])`) : null;
    if (target) {
      target.focus();
      refocus.current = null;
    }
  }, [entries]);

  if (!entries.length) return <p className="muted">The trip isn&apos;t shared with anyone yet.</p>;

  async function newLink(e: InvitationDTO) {
    setBusy(e.id);
    setError(null);
    const r = await onNewLink(e.email, e.role);
    setBusy(null);
    if (!r.ok) setError({ id: e.id, message: r.message });
  }

  async function setRole(e: InvitationDTO, role: Role) {
    setPromoting(null);
    if (role === e.role) return;
    setBusy(e.id);
    setError(null);
    const r = await api<InvitationDTO>("PATCH", `/api/trips/${tripId}/invitations/${e.id}`, { role });
    setBusy(null);
    if (!r.ok) {
      setError({ id: e.id, message: r.message });
      return;
    }
    onRoleChanged(r.data);
  }

  /** Choosing owner asks first, since owners can share and delete the trip; any other role applies at once. */
  function pickRole(e: InvitationDTO, role: Role) {
    if (role === "owner" && e.role !== "owner") setPromoting(e.id);
    else void setRole(e, role);
  }

  async function revoke(e: InvitationDTO) {
    if (e.status === "accepted" && confirming !== e.id) {
      setConfirming(e.id);
      return;
    }
    setBusy(e.id);
    setError(null);
    const r = await api<void>("DELETE", `/api/trips/${tripId}/invitations/${e.id}`);
    setBusy(null);
    setConfirming(null);
    if (!r.ok) {
      setError({ id: e.id, message: r.message });
      return;
    }
    refocus.current = e.id;
    onRevoked(e.id);
  }

  return (
    <ul className={styles.list}>
      {entries.map((e) => {
        const canRevoke = e.status === "pending" || e.status === "accepted";
        const canRenew = e.status !== "accepted";
        const disabled = busy === e.id;
        return (
          <li key={e.id} className={styles.row} data-entry={e.id} data-status={e.status}>
            <div className={styles.who}>
              <span className={styles.email}>{e.email}</span>
              <span className={styles.meta}>
                <Tag tone={e.status === "accepted" ? "soft" : "plain"}>{LABEL[e.status]}</Tag>
                <span>{detail(e)}</span>
              </span>
            </div>
            {e.status !== "revoked" ? (
              <Field
                label={<span className="visually-hidden">Role for {e.email}</span>}
                htmlFor={`role-${e.id}`}
                className={styles.role}
              >
                <select id={`role-${e.id}`} value={e.role} disabled={disabled} onChange={(ev) => pickRole(e, ev.target.value as Role)}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>
            ) : (
              <span className={styles.was}>Was {ROLE_LABEL[e.role].toLowerCase()}</span>
            )}
            {promoting === e.id ? (
              <div className={styles.actions} role="group" aria-label={`Make ${e.email} an owner`}>
                <span className={styles.ask}>{ROLE_HELP.owner} Make {e.email} an owner?</span>
                <Button variant="dangerFill" data-confirm-promote={e.id} disabled={disabled} onClick={() => void setRole(e, "owner")}>Make owner</Button>
                <Button variant="quiet" disabled={disabled} onClick={() => setPromoting(null)}>Cancel</Button>
              </div>
            ) : confirming === e.id ? (
              <div className={styles.actions} role="group" aria-label={`Revoke access for ${e.email}`}>
                <span className={styles.ask}>Revoke their access?</span>
                <Button variant="dangerFill" data-confirm-revoke={e.id} disabled={disabled} onClick={() => void revoke(e)}>Revoke access</Button>
                <Button variant="quiet" disabled={disabled} onClick={() => setConfirming(null)}>Keep</Button>
              </div>
            ) : (
              <div className={styles.actions}>
                {canRenew ? (
                  <Button variant="quiet" disabled={disabled} onClick={() => void newLink(e)} aria-label={`${canEmail ? "Send new link to" : "Create new link for"} ${e.email}`}>{canEmail ? "Send new link" : "Create new link"}</Button>
                ) : null}
                {canRevoke ? (
                  <Button variant="danger" disabled={disabled} onClick={() => void revoke(e)} aria-label={`Revoke ${e.email}`}>Revoke</Button>
                ) : null}
              </div>
            )}
            {error?.id === e.id ? <FormError className={styles.error}>{error.message}</FormError> : null}
          </li>
        );
      })}
    </ul>
  );
}
