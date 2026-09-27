"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/lib/cx";
import styles from "./Menu.module.css";

type TriggerProps = {
  ref: React.RefObject<HTMLButtonElement | null>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the button that opens the menu; spread the given props onto it. */
  trigger: (props: TriggerProps) => React.ReactNode;
  className?: string;
  /** Extra classes for the popup, e.g. to change its offset. */
  popupClassName?: string;
  children: React.ReactNode;
};

/**
 * Menu button (WAI-ARIA pattern): opens on click, Enter or Space; arrows, Home and End move;
 * Escape, Tab or a click outside close it and return focus to the button.
 */
export function Menu({ open, onOpenChange, trigger, className, popupClassName, children }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  useEffect(() => {
    change.current = onOpenChange;
  });

  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) change.current(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(popup.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      change.current(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items.at((i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length)?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items.at(e.key === "Home" ? 0 : -1)?.focus();
    }
  }

  return (
    <div className={cx(styles.wrap, className)} ref={wrap} data-open={open}>
      {trigger({ ref: button, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => onOpenChange(!open) })}
      <div className={cx(styles.popup, popupClassName)} role="menu" ref={popup} hidden={!open} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}

/** One action in a Menu. `danger` marks destructive actions (also said in the words). */
export function MenuItem({ icon, danger, className, children, type = "button", ...rest }: { icon?: React.ReactNode; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} role="menuitem" tabIndex={-1} className={cx(styles.item, danger && styles.danger, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** A non-interactive heading block at the top of a Menu. */
export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div className={styles.header}>{children}</div>;
}
