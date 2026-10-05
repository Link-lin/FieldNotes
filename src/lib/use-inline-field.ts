"use client";

import { useEffect, useRef, useState } from "react";
import { sameValue } from "@/shared/fields";

/** What a save says back: done, with an optional note and Undo, or why it failed (the draft stays). */
export type FieldSaveResult = { ok: true; note?: string; undo?: () => Promise<unknown> } | { ok: false; message: string; fields?: Array<{ path: string; message: string }> };
export type FieldStatus = { state: "idle" } | { state: "saving" } | { state: "saved"; note?: string; undo?: () => Promise<unknown> } | { state: "error"; message: string; fields?: Array<{ path: string; message: string }> };

const SAVED_MS = 3500;
const UNDO_MS = 12000;

/**
 * One value edited where it is shown (TRIP-10, DASH-6): open it, change it, and leaving it, Enter or picking a value
 * saves; Escape goes back to the saved value. The save gets the draft and the value it started from, so it can send
 * that as the field's starting value. A failed save keeps the draft open with its error. Also used for a section edited
 * as a group, whose Save and Cancel call `commit` and `cancel`.
 */
export function useInlineField<T>({ read, save, same = sameValue, initiallyOpen = false }: { read: () => T; save: (draft: T, start: T) => Promise<FieldSaveResult>; same?: (a: T, b: T) => boolean; initiallyOpen?: boolean }) {
  const [editing, setEditing] = useState(initiallyOpen);
  const [draft, setDraft] = useState<T>(read);
  const [status, setStatus] = useState<FieldStatus>({ state: "idle" });
  // Where the edit began: a ref for the save, and state for telling whether there are unsaved changes.
  const start = useRef<T>(draft);
  const [startValue, setStartValue] = useState<T>(draft);
  const busy = useRef(false);

  // "Saved" (and its Undo) fades after a while.
  useEffect(() => {
    if (status.state !== "saved") return;
    const t = setTimeout(() => setStatus({ state: "idle" }), status.undo ? UNDO_MS : SAVED_MS);
    return () => clearTimeout(t);
  }, [status]);

  function open() {
    const now = read();
    start.current = now;
    setStartValue(now);
    setDraft(now);
    setStatus({ state: "idle" });
    setEditing(true);
  }

  async function commit(value: T = draft): Promise<boolean> {
    if (busy.current) return false;
    if (same(value, start.current)) {
      setEditing(false);
      setStatus({ state: "idle" });
      return true;
    }
    busy.current = true;
    setStatus({ state: "saving" });
    const r = await save(value, start.current);
    busy.current = false;
    if (r.ok) {
      setEditing(false);
      setStatus({ state: "saved", note: r.note, undo: r.undo });
      return true;
    }
    setDraft(value);
    setStatus({ state: "error", message: r.message, fields: r.fields });
    return false;
  }

  /** Saves a value straight from the view, without opening the controls (Remove point, Mark booked). */
  function saveNow(value: T): Promise<boolean> {
    start.current = read();
    setStartValue(start.current);
    return commit(value);
  }

  function cancel() {
    if (busy.current) return;
    setEditing(false);
    setStatus({ state: "idle" });
  }

  async function undo() {
    if (status.state !== "saved" || !status.undo) return;
    const fn = status.undo;
    setStatus({ state: "saving" });
    await fn();
    setStatus({ state: "idle" });
  }

  return {
    editing,
    draft,
    setDraft,
    open,
    commit,
    saveNow,
    cancel,
    undo,
    status,
    saving: status.state === "saving",
    /** Open with a change that isn't saved yet. */
    dirty: editing && !same(draft, startValue),
    /** The server's message for one field path, after a failed save. */
    error: (path: string) => (status.state === "error" ? status.fields?.find((f) => f.path === path || f.path.startsWith(`${path}.`))?.message : undefined),
  };
}
