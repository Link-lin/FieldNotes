"use client";

import { useId } from "react";
import type { OwnedTripDTO } from "@/shared/dto";
import { ROLE_LABEL } from "@/shared/roles";
import { Field } from "@/components/ui/Field/Field";
import { dateRangeLabel } from "@/lib/format";
import { namesText, type Choice } from "../owned-trip-choice";
import styles from "./OwnedTripChoice.module.css";

type Props = { trip: OwnedTripDTO; choice: Choice; onChange: (choice: Choice) => void };

/**
 * ACCESS-10: what happens to one owned trip when its owner deletes their account. A trip another owner keeps
 * can stay with them or be deleted; a trip nobody else owns asks who becomes its owner (the next in line is
 * preselected by the dialog) or offers deleting it; a trip nobody else has joined is simply deleted.
 */
export function OwnedTripChoice({ trip, choice, onChange }: Props) {
  const id = useId();
  const dates = dateRangeLabel(trip);
  const title = (
    <>
      <span className={styles.title}>{trip.title}</span> <span className={styles.dates}>{dates}</span>
    </>
  );

  if (!trip.otherOwners.length && !trip.people.length) {
    return (
      <li className={styles.trip}>
        <span>{title}</span>
        <p className={styles.note}>Nobody else has joined this trip, so it will be deleted.</p>
      </li>
    );
  }

  const keeps = trip.otherOwners.length > 0;
  const hint =
    choice === "delete"
      ? "Deleted for everyone it is shared with, with its events and bookings."
      : keeps
        ? `${namesText(trip.otherOwners)} will keep owning it.`
        : "Nobody else owns this trip. The new owner can change it, share it and delete it.";

  return (
    <li className={styles.trip}>
      <Field label={title} htmlFor={`${id}-choice`} hint={hint} hintId={`${id}-hint`}>
        <select id={`${id}-choice`} value={choice} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`}>
          {keeps ? (
            <option value="keep">Keep it</option>
          ) : (
            trip.people.map((p) => (
              <option key={p.id} value={p.id}>
                Make {p.email} the owner ({ROLE_LABEL[p.role].toLowerCase()} now)
              </option>
            ))
          )}
          <option value="delete">Delete it for everyone</option>
        </select>
      </Field>
    </li>
  );
}
