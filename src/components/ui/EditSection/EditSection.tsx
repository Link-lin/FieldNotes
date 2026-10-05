"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button/Button";
import { FormError } from "@/components/ui/Field/Field";
import type { FieldStatus } from "@/lib/use-inline-field";
import { SaveStatus } from "@/components/ui/SaveStatus/SaveStatus";
import styles from "./EditSection.module.css";

type Props = {
  title: string;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  /** Cancel: back to the saved values, without asking (the button says what it does). */
  onCancel: () => void;
  /** Escape inside the open section: the owner asks first when something is typed. */
  onEscape?: () => void;
  onSave: () => void;
  status: FieldStatus;
  onUndo?: () => void;
  /** What the section shows when it isn't open. */
  view: React.ReactNode;
  /** The section's fields while it is open. */
  children: React.ReactNode;
  saveLabel?: string;
  /** Save can't go ahead yet (a question in the section still needs an answer). */
  saveDisabled?: boolean;
  className?: string;
};

/**
 * A group of values that depend on each other, edited in place (TRIP-10, DASH-6): the section keeps its heading and
 * place, and its view turns into its fields with Save and Cancel for that section only. Focus moves to the first field
 * on open and back to Edit when it closes. Saving…, Saved (with Undo where offered) and a failed save's message show
 * under it; a failed save keeps the fields as typed.
 */
export function EditSection({ title, canEdit, editing, onEdit, onCancel, onEscape, onSave, status, onUndo, view, children, saveLabel = "Save", saveDisabled = false, className }: Props) {
  const headingId = useId();
  const box = useRef<HTMLElement>(null);
  const wasEditing = useRef(editing);

  useEffect(() => {
    if (editing && !wasEditing.current) box.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
    if (!editing && wasEditing.current) {
      // Back to Edit, unless focus already moved on to something else outside the section.
      const active = document.activeElement;
      if (!active || active === document.body || box.current?.contains(active)) requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[data-section-edit]")?.focus());
    }
    wasEditing.current = editing;
  }, [editing]);

  const saving = status.state === "saving";
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} aria-labelledby={headingId} data-editing={editing || undefined} ref={box}>
      <div className={styles.head}>
        <h3 className={styles.title} id={headingId}>{title}</h3>
        {canEdit && !editing ? (
          <Button variant="quiet" data-section-edit onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>Edit</Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className={styles.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            e.preventDefault();
            (onEscape ?? onCancel)();
          }}
        >
          {children}
          {status.state === "error" ? <FormError>{status.message}</FormError> : null}
          <div className={styles.actions}>
            <Button variant="quiet" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button variant="fill" type="submit" disabled={saving || saveDisabled}>{saving ? "Saving…" : saveLabel}</Button>
          </div>
        </form>
      ) : (
        view
      )}
      {!editing ? <SaveStatus status={status} onUndo={onUndo} showSaving={false} /> : null}
    </section>
  );
}

/** A section with the same heading, its fields always shown: for a form that creates something in the same layout. */
export function SectionFrame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h3 className={styles.title} id={headingId}>{title}</h3>
      </div>
      {children}
    </section>
  );
}
