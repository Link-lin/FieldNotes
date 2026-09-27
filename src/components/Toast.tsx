"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastSpec = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Selector focused if the toast held focus when it closes. */
  afterFocus?: string;
};
type Ctx = (t: ToastSpec) => void;
const ToastContext = createContext<Ctx>(() => {});
export const useToast = () => useContext(ToastContext);

/** Status toasts; an action toast takes focus, lasts at least 10 s and pauses on hover or focus. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { key: number }) | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback((refocus: boolean) => {
    const had = box.current?.contains(document.activeElement);
    setToast((cur) => {
      if (refocus && had) {
        const next = (cur?.afterFocus && document.querySelector<HTMLElement>(cur.afterFocus)) || document.querySelector<HTMLElement>("h1[tabindex]");
        requestAnimationFrame(() => next?.focus());
      }
      return null;
    });
  }, []);

  const arm = useCallback(
    (ms: number) => {
      const schedule = (delay: number) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (box.current && (box.current.matches(":hover") || box.current.contains(document.activeElement))) schedule(1500);
          else hide(true);
        }, delay);
      };
      schedule(ms);
    },
    [hide],
  );

  const show = useCallback((t: ToastSpec) => setToast({ ...t, key: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    if (toast.actionLabel) action.current?.focus();
    arm(toast.actionLabel ? 12000 : 3600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, arm]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="visually-hidden">{toast?.message}</div>
      {toast ? (
        <div
          className="toast"
          ref={box}
          key={toast.key}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              hide(true);
            }
          }}
        >
          <span>{toast.message}</span>
          {toast.actionLabel ? (
            <button
              type="button"
              ref={action}
              onClick={() => {
                const fn = toast.onAction;
                setToast(null);
                fn?.();
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
