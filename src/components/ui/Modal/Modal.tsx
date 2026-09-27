"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
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

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

/** Accessible dialog: focus trap, inert background, Escape to close, focus returned to the trigger. */
export function Modal({ title, subtitle, onClose, children, fallbackFocus, triggerSelector }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<Element | null>(null);
  const titleId = useId();
  const close = useRef(onClose);
  const restore = useRef({ fallbackFocus, triggerSelector });
  useEffect(() => {
    close.current = onClose;
    restore.current = { fallbackFocus, triggerSelector };
  });

  useEffect(() => {
    trigger.current = document.activeElement;
    const root = document.getElementById("app-root");
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select, textarea') ?? ref.current?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();
    return () => {
      if (root) root.inert = false;
      document.body.style.overflow = "";
      const t = trigger.current as HTMLElement | null;
      const visible = (el: HTMLElement | null) => !!el && el.isConnected && el.getClientRects().length > 0;
      let target: HTMLElement | null = visible(t) ? t : null;
      if (!target && restore.current.triggerSelector) target = document.querySelector<HTMLElement>(restore.current.triggerSelector);
      if (!visible(target)) target = restore.current.fallbackFocus?.() ?? null;
      // Wait a frame so a re-render that replaced the trigger has committed.
      requestAnimationFrame(() => {
        const again = restore.current.triggerSelector ? document.querySelector<HTMLElement>(restore.current.triggerSelector) : null;
        (visible(again) ? again : target)?.focus();
      });
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.getClientRects().length > 0);
    const a = items[0];
    const z = items[items.length - 1];
    if (!a || !z) return;
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  }

  return createPortal(
    <div className={styles.backdrop} data-modal onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
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
