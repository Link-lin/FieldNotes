"use client";

import { useEffect, useRef, useState } from "react";
import type { InvitationDTO, InvitationStatus } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { FormError } from "@/components/ui/Field/Field";
import { Tag } from "@/components/ui/Tag/Tag";
import { api } from "@/lib/api";
import { instantDate } from "@/lib/format";
import styles from "./ViewerList.module.css";

/** The outcome of asking for a new link; the parent shows the link itself. */
export type IssueResult = { ok: true } | { ok: false; message: string; onEmail: boolean };

type Props = {
  tripId: string;
  entries: InvitationDTO[];
  onNewLink: (email: string) => Promise<IssueResult>;
  onRevoked: (id: string) => void;
};

const LABEL: Record<InvitationStatus, string> = { pending: "Invited", accepted: "Viewer", expired: "Link expired", revoked: "Revoked" };

function detail(e: InvitationDTO): string {
  if (e.status === "pending") return e.expiresAt ? `Link expires ${instantDate(e.expiresAt)}` : "";
  if (e.status === "expired") return e.expiresAt ? `Link expired ${instantDate(e.expiresAt)}` : "";
  if (e.status === "accepted") return e.acceptedAt ? `Can view since ${instantDate(e.acceptedAt)}` : "Can view";
  return e.revokedAt ? `Access revoked ${instantDate(e.revokedAt)}` : "Access revoked";
}

/**
 * ACCESS-6/11: viewers and invitations with status and expiry. Revoke is offered for pending and
 * accepted entries (an accepted viewer is asked to confirm); Create new link for pending, expired
 * and revoked entries, and it invalidates any earlier link.
 */
export function ViewerList({ tripId, entries, onNewLink, onRevoked }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  // After a revoke the row's buttons change; keep focus in that row once the list reloads.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    if (confirming) document.querySelector<HTMLElement>(`[data-confirm-revoke="${confirming}"]`)?.focus();
  }, [confirming]);

  useEffect(() => {
    const id = refocus.current;
    const target = id ? document.querySelector<HTMLElement>(`[data-entry="${id}"] button:not([disabled])`) : null;
    if (target) {
      target.focus();
      refocus.current = null;
    }
  }, [entries]);

  if (!entries.length) return <p className="muted">No one else can see this trip yet.</p>;

  async function newLink(e: InvitationDTO) {
    setBusy(e.id);
    setError(null);
    const r = await onNewLink(e.email);
    setBusy(null);
    if (!r.ok) setError({ id: e.id, message: r.message });
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
            {confirming === e.id ? (
              <div className={styles.actions} role="group" aria-label={`Revoke access for ${e.email}`}>
                <span className={styles.ask}>Revoke their access?</span>
                <Button variant="dangerFill" data-confirm-revoke={e.id} disabled={disabled} onClick={() => void revoke(e)}>Revoke access</Button>
                <Button variant="quiet" disabled={disabled} onClick={() => setConfirming(null)}>Keep</Button>
              </div>
            ) : (
              <div className={styles.actions}>
                {canRenew ? (
                  <Button variant="quiet" disabled={disabled} onClick={() => void newLink(e)} aria-label={`Create new link for ${e.email}`}>Create new link</Button>
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
