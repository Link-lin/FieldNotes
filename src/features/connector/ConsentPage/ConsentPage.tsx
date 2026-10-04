"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { Card } from "@/components/ui/Card/Card";
import { CheckField, FormError } from "@/components/ui/Field/Field";
import { api } from "@/lib/api";
import styles from "./ConsentPage.module.css";

type Props = {
  /** What the app calls itself. Untrusted text: rendered as text only. */
  appName: string;
  /** Where approving sends the person back to, as host and port. */
  returnHost: string;
  /** Every address the app registered is on this computer. */
  runsLocally: boolean;
  /** The app asked to make changes, not only to read. */
  wantsChanges: boolean;
  accountName: string;
  accountEmail: string | null;
  /** The authorization request exactly as it arrived, sent back with the decision. */
  params: Record<string, string>;
};

/**
 * CONNECT-2: the person decides whether an AI app may use their Field Notes account. It names the app as it names itself,
 * says where approving sends them and who they are approving as, and offers Read (always) and Make changes (only when
 * the app asked for it). Nothing is granted until Allow; the decision is posted, and the browser then goes where the
 * server says (the app's own address with a code, or an error), by script because a registered address could be anything.
 */
export function ConsentPage({ appName, returnHost, runsLocally, wantsChanges, accountName, accountEmail, params }: Props) {
  const id = useId();
  const [allowChanges, setAllowChanges] = useState(true);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function decide(decision: "allow" | "deny") {
    setError(null);
    setBusy(decision);
    const r = await api<{ redirectTo: string }>("POST", "/api/connector/approve", { ...params, decision, allowChanges: wantsChanges && allowChanges });
    if (!r.ok) {
      setBusy(null);
      setError(r.message);
      return;
    }
    setLeaving(true);
    window.location.assign(r.data.redirectTo);
  }

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <p className={`mono ${styles.eyebrow}`}>Connect an AI app</p>
        <h1 className={styles.title} id={`${id}-title`}>Let {appName} use Field Notes?</h1>
        <p className="note">
          You are approving as <b>{accountName}</b>
          {accountEmail ? <> ({accountEmail})</> : null}. If that is not the account you want, sign out and start again from the app.
        </p>
        <ul className={styles.permissions} aria-labelledby={`${id}-title`}>
          <li className={styles.permission}>
            <p className={styles.permissionTitle}>Read your trips <span className={`mono ${styles.always}`}>Always</span></p>
            <p className="note">Titles, dates, events, bookings and planned prices on every trip you own or were invited to.</p>
          </li>
          {wantsChanges ? (
            <li className={styles.permission}>
              <CheckField
                label={<span className={styles.permissionTitle}>Make changes for you</span>}
                checked={allowChanges}
                onChange={(e) => setAllowChanges(e.target.checked)}
                disabled={busy !== null}
                aria-describedby={`${id}-changes`}
              />
              <p className="note" id={`${id}-changes`}>
                Add events and trips, and change or delete events, as far as your role on each trip allows. Everything it adds is marked as an unverified AI draft.
              </p>
            </li>
          ) : null}
        </ul>
        <p className="note">It can&apos;t mark a booking confirmed, share a trip, change who has access, or delete a trip. Those stay in Field Notes.</p>
        <p className={styles.where}>
          After you choose, you are sent back to <b className="mono">{returnHost}</b>
          {runsLocally ? ", an app running on this computer" : ""}. The name above is the one the app gave itself. What {appName} reads goes to its provider, under that provider&apos;s privacy policy. You can disconnect it at any time from the account menu, under AI connector.
        </p>
        {error ? <FormError>{error}</FormError> : null}
        {leaving ? <p className="muted" role="status">Sending you back to {returnHost}…</p> : null}
        <div className={styles.actions}>
          <Button variant="quiet" onClick={() => void decide("deny")} disabled={busy !== null}>{busy === "deny" ? "Cancelling…" : "Cancel"}</Button>
          <Button variant="fill" onClick={() => void decide("allow")} disabled={busy !== null}>{busy === "allow" ? "Allowing…" : "Allow"}</Button>
        </div>
      </Card>
    </main>
  );
}
