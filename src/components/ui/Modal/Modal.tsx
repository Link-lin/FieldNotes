"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/lib/use-dialog";
import styles from "./Modal.module.css";

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Where focus goes if the trigger no longer exists after the dialog closes. */
  fallbackFocus?: () => HTMLElement | null;
  /** A stable selector for the trigger, used when a re-render replaced it. */
  triggerSelector?: string | null;
};

/** Accessible dialog: focus trap, inert background, Escape to close, focus returned to the trigger. */
export function Modal({ title, subtitle, onClose, children, fallbackFocus, triggerSelector }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { onKeyDown, close } = useDialog(ref, { active: true, onClose, fallbackFocus, triggerSelector });

  return createPortal(
    <div className={styles.backdrop} data-modal onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={onKeyDown}>
        <h2 className={styles.title} id={titleId}>{title}</h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The row of buttons at the foot of a dialog, aligned right. */
export function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
