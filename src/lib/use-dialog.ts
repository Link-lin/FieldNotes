"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

type Options = {
  /** While true the dialog is open: the page behind is inert, scrolling is locked and focus is inside. */
  active: boolean;
  onClose: () => void;
  /** Where focus goes if the trigger no longer exists after the dialog closes. */
  fallbackFocus?: () => HTMLElement | null;
  /** A stable selector for the trigger, used when a re-render replaced it. */
  triggerSelector?: string | null;
  /** The element to focus on open; defaults to the first field, else the first button. */
  initialFocus?: () => HTMLElement | null;
};

/**
 * Shared behaviour of the app's modal surfaces (Modal, SidePanel): background `#app-root` made
 * inert, page scroll locked, focus moved in on open and returned to the trigger on close, Tab
 * kept inside, Escape closes. Returns the dialog's keydown handler and a close function that
 * always calls the latest `onClose`.
 */
export function useDialog(ref: React.RefObject<HTMLElement | null>, { active, onClose, fallbackFocus, triggerSelector, initialFocus }: Options) {
  const close = useRef(onClose);
  const opts = useRef({ fallbackFocus, triggerSelector, initialFocus });
  useEffect(() => {
    close.current = onClose;
    opts.current = { fallbackFocus, triggerSelector, initialFocus };
  });

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    const root = document.getElementById("app-root");
    if (root) root.inert = true;
    // A dialog opened over another (a confirmation over a side panel) makes the one below inert too.
    const below = [...document.querySelectorAll<HTMLElement>("[data-modal]")].filter((d) => el && !d.contains(el) && !d.inert);
    below.forEach((d) => (d.inert = true));
    document.body.style.overflow = "hidden";
    const first =
      opts.current.initialFocus?.() ??
      el?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select, textarea') ??
      el?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus();
    // Escape still closes if focus has fallen out of the dialog (for example onto a button that
    // just became disabled). Inside the dialog, onKeyDown handles it and stops propagation.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !el?.contains(document.activeElement)) close.current();
    };
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("keydown", onDocKey);
      below.forEach((d) => (d.inert = false));
      // The page stays inert and still while a dialog below this one is open.
      const stillOpen = below.some((d) => d.isConnected);
      if (root && !stillOpen) root.inert = false;
      if (!stillOpen) document.body.style.overflow = "";
      const visible = (el: HTMLElement | null) => !!el && el.isConnected && el.getClientRects().length > 0;
      let target: HTMLElement | null = visible(trigger) ? trigger : null;
      if (!target && opts.current.triggerSelector) target = document.querySelector<HTMLElement>(opts.current.triggerSelector);
      if (!visible(target)) target = opts.current.fallbackFocus?.() ?? null;
      // Wait a frame so a re-render that replaced the trigger has committed. Leave focus alone if
      // another dialog opened in the meantime (for example Edit event from the side panel).
      requestAnimationFrame(() => {
        const other = document.activeElement?.closest('[role="dialog"]');
        if (other && other !== el) return;
        const again = opts.current.triggerSelector ? document.querySelector<HTMLElement>(opts.current.triggerSelector) : null;
        (visible(again) ? again : target)?.focus();
      });
    };
  }, [active, ref]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Handled: a dialog below this one, or the page, must not act on the same key.
      e.stopPropagation();
      e.preventDefault();
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

  return { onKeyDown, close: () => close.current() };
}
