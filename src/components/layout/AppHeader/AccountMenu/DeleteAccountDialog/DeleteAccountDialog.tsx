"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { api } from "@/lib/api";
import styles from "./DeleteAccountDialog.module.css";

/** Confirms account deletion by typing DELETE; lists the trips that go with it. */
export function DeleteAccountDialog({ ownedTrips, onClose, returnFocus }: { ownedTrips: string[]; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <Modal
      title="Delete my account"
      onClose={onClose}
      fallbackFocus={returnFocus}
      subtitle={
        <>
          This signs you out and removes your sign-in identity. Trips shared with you stop being visible to you.
          {ownedTrips.length ? ` It also permanently deletes ${ownedTrips.length === 1 ? "the trip" : `the ${ownedTrips.length} trips`} you own, with their events, booking lists and invitations:` : ""}
        </>
      }
    >
      {ownedTrips.length ? (
        <ul className={styles.trips}>
          {ownedTrips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}
      <Field label="Type DELETE to confirm" htmlFor="acct-confirm">
        <input id="acct-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-invalid={error ? true : undefined} aria-describedby={error ? "acct-err" : undefined} />
      </Field>
      {error ? <FormError id="acct-err">{error}</FormError> : null}
      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="dangerFill" onClick={deleteAccount} disabled={busy}>
          {busy ? "Deleting…" : "Delete my account"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
