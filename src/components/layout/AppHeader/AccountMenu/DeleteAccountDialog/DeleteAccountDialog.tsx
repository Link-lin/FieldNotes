"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnedTripDTO } from "@/shared/dto";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { defaultChoice, toDecision, validChoice, type Choice, type Decision } from "./owned-trip-choice";
import { OwnedTripChoice } from "./OwnedTripChoice/OwnedTripChoice";
import styles from "./DeleteAccountDialog.module.css";

/**
 * ACCESS-10: confirms account deletion by typing DELETE, after the person has chosen what happens to each trip
 * they own: another owner keeps it, a new owner is chosen (the next in line is suggested), or it is deleted.
 */
export function DeleteAccountDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const router = useRouter();
  const id = useId();
  const [trips, setTrips] = useState<OwnedTripDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bumped to load the list again (Try again, or after a choice turned out to be out of date).
  const [loads, setLoads] = useState(0);
  const reload = () => {
    setLoadError(null);
    setLoads((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    void api<OwnedTripDTO[]>("GET", "/api/account/owned-trips").then((r) => {
      if (!live) return;
      if (!r.ok) {
        setLoadError(r.message);
        return;
      }
      setTrips(r.data);
      // Keep the choices that still fit; everything else starts at its default.
      setChoices((old) => Object.fromEntries(r.data.map((t) => [t.id, validChoice(t, old[t.id]) ? old[t.id]! : defaultChoice(t)])));
    });
    return () => {
      live = false;
    };
  }, [loads]);

  const choiceFor = (t: OwnedTripDTO): Choice => choices[t.id] ?? defaultChoice(t);
  const deleting = (trips ?? []).filter((t) => choiceFor(t) === "delete");

  async function deleteAccount() {
    if (typed !== "DELETE") {
      setError("Type DELETE to confirm.");
      return;
    }
    if (!trips) return;
    const decisions = trips.map((t) => toDecision(t, choiceFor(t))).filter((d): d is Decision => d !== null);
    setBusy(true);
    const r = await api<void>("DELETE", "/api/account", { confirm: "DELETE", trips: decisions });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      // A trip changed while the dialog was open: show it as it is now and keep the choices that still fit.
      if (r.status === 409 || r.status === 422) reload();
      return;
    }
    router.replace("/sign-in?deleted=1");
    router.refresh();
  }

  return (
    <Modal
      title="Delete my account"
      onClose={onClose}
      fallbackFocus={returnFocus}
      subtitle="This signs you out and removes your sign-in identity. Trips shared with you stop being visible to you, and you leave them."
    >
      {loadError ? (
        <div className={styles.loadError}>
          <FormError>{loadError}</FormError>
          <Button variant="quiet" onClick={reload}>Try again</Button>
        </div>
      ) : trips === null ? (
        <p className="muted" role="status">Checking your trips…</p>
      ) : trips.length ? (
        <section className={styles.section} aria-labelledby={`${id}-trips`}>
          <h3 id={`${id}-trips`} className={styles.heading}>Trips you own</h3>
          <p className="note">Choose what happens to each one. A trip nobody else owns needs a new owner, or it can be deleted for everyone.</p>
          <ul className={styles.trips}>
            {trips.map((t) => (
              <OwnedTripChoice key={t.id} trip={t} choice={choiceFor(t)} onChange={(c) => setChoices((all) => ({ ...all, [t.id]: c }))} />
            ))}
          </ul>
        </section>
      ) : null}
      {deleting.length ? (
        <Banner tone="warn">
          {deleting.length === 1 ? "This trip" : `These ${plural(deleting.length, "trip")}`} will be permanently deleted for everyone {deleting.length === 1 ? "it is" : "they are"} shared with:{" "}
          {deleting.map((t) => t.title).join(", ")}.
        </Banner>
      ) : null}
      <Field label="Type DELETE to confirm" htmlFor="acct-confirm">
        <input id="acct-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-invalid={error ? true : undefined} aria-describedby={error ? "acct-err" : undefined} />
      </Field>
      {error ? <FormError id="acct-err">{error}</FormError> : null}
      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="dangerFill" onClick={deleteAccount} disabled={busy || trips === null}>
          {busy ? "Deleting…" : "Delete my account"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
