"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TripDetailDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { useToast } from "@/components/ui/Toast/Toast";
import { api } from "@/lib/api";

/** TRIP-5: permanent trip deletion, confirmed by typing the trip's name. */
export function DeleteTripDialog({ trip, onCancel }: { trip: TripDetailDTO["trip"]; onCancel: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    const r = await api<void>("DELETE", `/api/trips/${trip.id}`, { confirm: true, expectedVersion: trip.version });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    toast({ message: "Trip deleted." });
    router.push("/");
    router.refresh();
  }

  return (
    <Modal title="Delete this trip?" onClose={onCancel} subtitle={<>This permanently deletes <b>{trip.title}</b>, its events and booking list, and revokes every invitation. There is no undo.</>}>
      <Field label="Type the trip name to confirm" htmlFor="del-trip-name">
        <input id="del-trip-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={trip.title} />
      </Field>
      {error ? <FormError>{error}</FormError> : null}
      <ModalActions>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button variant="dangerFill" disabled={typed !== trip.title || busy} onClick={doDelete}>Delete permanently</Button>
      </ModalActions>
    </Modal>
  );
}
