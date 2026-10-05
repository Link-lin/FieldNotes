"use client";

import { useEffect, useId, useRef } from "react";
import { EditIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import type { FieldStatus } from "@/lib/use-inline-field";
import { SaveStatus } from "@/components/ui/SaveStatus/SaveStatus";
import styles from "./InlineEdit.module.css";

type Props = {
  /** What it edits, for its accessible names ("Planned price"). */
  label: string;
  /** The value as read out after "Edit planned price,"; defaults to the shown text. */
  valueText?: string;
  /** The value as shown. */
  children: React.ReactNode;
  /** Shown to people who can edit when there is no value ("Add a price"). */
  placeholder?: string;
  empty?: boolean;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  /** Focus left the controls, or Enter: save the draft. */
  onCommit: () => void;
  /** Escape: back to the saved value. */
  onCancel: () => void;
  /** The controls while editing; give each `aria-describedby={describedBy}`. */
  controls: (ids: { describedBy: string }) => React.ReactNode;
  status: FieldStatus;
  onUndo?: () => void;
  /** Enter in a text field saves (default). Off for a field where Enter adds a line. */
  enterSaves?: boolean;
  className?: string;
  /** The heading level a title is shown at; plain values are inline. */
  as?: "h1" | "h2" | "div" | "span";
  headingId?: string;
  /** The heading can take focus from script (tabIndex -1), as a page's focus fallback. */
  focusable?: boolean;
};

/**
 * A value edited where it is shown (TRIP-10, DASH-6). People who can edit see it as a button with a quiet pencil;
 * clicking it, Enter or Space opens its controls in place, focused. Enter, picking a value or leaving the controls
 * saves; Escape goes back. Saving…, Saved (with Undo where offered) and errors show under it. Others see plain text.
 */
export function InlineEdit({ label, valueText, children, placeholder, empty = false, canEdit, editing, onEdit, onCommit, onCancel, controls, status, onUndo, enterSaves = true, className, as: Tag = "div", headingId, focusable = false }: Props) {
  const id = useId();
  const statusId = `${id}-status`;
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);

  useEffect(() => {
    if (editing && !wasEditing.current) {
      const first = box.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
      first?.focus();
      if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) first.select();
    }
    // Closed by Enter, Escape or picking a value: focus was in the controls, which are gone, so it goes back to the
    // value. Closed by Tab or a click elsewhere: focus has moved on, and stays there.
    if (!editing && wasEditing.current) {
      const active = document.activeElement;
      if (!active || active === document.body) requestAnimationFrame(() => trigger.current?.focus());
    }
    wasEditing.current = editing;
  }, [editing]);

  const statusLine = <SaveStatus id={statusId} status={status} onUndo={onUndo} showError />;

  const tabIndex = focusable ? -1 : undefined;
  if (!canEdit) return <Tag className={cx(styles.value, className)} id={headingId} tabIndex={tabIndex}>{children}</Tag>;

  if (!editing) {
    return (
      <div className={cx(styles.field, className)}>
        <Tag className={styles.heading} id={headingId} tabIndex={tabIndex}>
          <button
            type="button"
            ref={trigger}
            className={styles.trigger}
            data-inline-edit={label}
            aria-label={`Edit ${label.toLowerCase()}${empty ? "" : `, ${valueText ?? (typeof children === "string" ? children : "")}`}`.replace(/, $/, "")}
            onClick={onEdit}
          >
            {empty ? <span className={styles.placeholder}>{placeholder ?? `Add ${label.toLowerCase()}`}</span> : children}
            <span className={styles.pencil} aria-hidden="true"><EditIcon /></span>
          </button>
        </Tag>
        {status.state !== "idle" ? statusLine : null}
      </div>
    );
  }

  return (
    <div
      className={cx(styles.field, styles.editing, className)}
      ref={box}
      onBlur={(e) => {
        // Leaving the controls (to anything outside them) saves.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey && enterSaves && (e.target as HTMLElement).matches("input:not([type=checkbox]), textarea")) {
          e.preventDefault();
          onCommit();
        }
      }}
    >
      {controls({ describedBy: statusId })}
      {statusLine}
    </div>
  );
}
