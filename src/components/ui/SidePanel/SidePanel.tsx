"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/cx";
import { useDialog } from "@/lib/use-dialog";
import styles from "./SidePanel.module.css";

type Props = {
  /** False while the panel slides out; it unmounts (onExited) when that finishes. */
  open: boolean;
  /** A close was asked for (the close button, Escape, the faded page). The owner decides, after asking about unsaved changes if needed. */
  onClose: () => void;
  onExited?: () => void;
  /** The panel's accessible name, or the id of the heading that names it. */
  label?: string;
  labelledBy?: string;
  /** The left of the sticky bar: Previous and Next, a back button, or the panel's title. */
  bar?: React.ReactNode;
  /** Actions on the right of the bar, before the close button. */
  actions?: React.ReactNode;
  /** Messages under the bar, such as unsaved changes or a deletion elsewhere. */
  notices?: React.ReactNode;
  /** A sticky foot for a form's main actions. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** "page": the same surface as a page of its own (the phone event page): no wash and no focus trap. */
  presentation?: "panel" | "page";
  /** The event view is wide for its map; forms and lists are narrower. */
  size?: "wide" | "medium";
  closeLabel: string;
  /** Visible text on the close button of a page ("← Trip"); a panel shows ×. */
  closeText?: string;
  closeDisabled?: boolean;
  triggerSelector?: string | null;
  fallbackFocus?: () => HTMLElement | null;
  /** Defaults to the close button. */
  initialFocus?: () => HTMLElement | null;
  /** Replays the content's entrance when it changes, for example when stepping to another event. */
  contentKey?: string;
  panelRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  /** At phone widths the bar's left part takes a second row of its own (Previous and Next). */
  barWraps?: boolean;
};

// Longest exit animation; unmount after it even when animations are off (reduced motion).
const EXIT_MS = 320;

/**
 * The app's right-hand panel for viewing, editing and creating things (events, the trip's details, sharing): it slides
 * in from the right while the page fades behind a paper-coloured wash, with a sticky bar, a scrolling body and an
 * optional sticky foot. Escape, the close button or a click on the faded page ask to close; focus moves in on open and
 * back to the trigger on close (useDialog). At phone widths it fills the screen.
 */
export function SidePanel({
  open, onClose, onExited, label, labelledBy, bar, actions, notices, footer, children, presentation = "panel", size = "medium",
  closeLabel, closeText, closeDisabled = false, triggerSelector, fallbackFocus, initialFocus, contentKey, panelRef, className, barWraps = false,
}: Props) {
  const own = useRef<HTMLElement>(null);
  const ref = panelRef ?? own;
  const isPanel = presentation === "panel";
  const { onKeyDown, close } = useDialog(ref, {
    active: isPanel && open,
    onClose,
    triggerSelector,
    fallbackFocus,
    initialFocus: initialFocus ?? (() => ref.current?.querySelector<HTMLElement>("[data-panel-close]") ?? null),
  });

  const exited = useRef(onExited);
  useEffect(() => {
    exited.current = onExited;
  });
  useEffect(() => {
    if (open || !isPanel) return;
    const t = setTimeout(() => exited.current?.(), EXIT_MS + 60);
    return () => clearTimeout(t);
  }, [open, isPanel]);

  const surface = (
    <section
      className={cx(styles.panel, className)}
      data-presentation={presentation}
      data-size={size}
      data-bar-wraps={barWraps || undefined}
      role={isPanel ? "dialog" : undefined}
      aria-modal={isPanel ? true : undefined}
      aria-label={label}
      aria-labelledby={label ? undefined : labelledBy}
      ref={ref}
      onKeyDown={isPanel ? onKeyDown : undefined}
      inert={isPanel && !open}
    >
      <div className={styles.bar}>
        <div className={styles.barStart}>{bar}</div>
        <div className={styles.barActions}>
          {actions}
          <button type="button" className={styles.close} data-panel-close aria-label={closeLabel} disabled={closeDisabled} onClick={close}>
            {!isPanel && closeText ? closeText : "×"}
          </button>
        </div>
      </div>
      {notices}
      <div className={styles.body} key={contentKey}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </section>
  );

  if (!isPanel) return <main className={styles.page}>{surface}</main>;
  return createPortal(
    <div
      className={styles.backdrop}
      data-modal
      data-state={open ? "open" : "closing"}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onAnimationEnd={(e) => { if (!open && e.target === e.currentTarget) onExited?.(); }}
    >
      {surface}
    </div>,
    document.body,
  );
}

/** A notice under the panel's bar: unsaved changes to keep or discard, or another choice that needs an answer. */
export function PanelNotice({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={styles.notice} role="alert">
      <p>{children}</p>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
