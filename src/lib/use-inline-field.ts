"use client";

import { createContext, useContext, useEffect, useRef, useState, type SetStateAction } from "react";
import { sameValue } from "@/shared/fields";

/**
 * What a save says back: done, with an optional note and Undo, or why it failed (the draft stays). `conflict`: the value
 * was changed elsewhere meanwhile, so trying the same save again can't work.
 */
export type FieldSaveResult = { ok: true; note?: string; undo?: () => Promise<FieldSaveResult> } | { ok: false; message: string; fields?: Array<{ path: string; message: string }>; conflict?: boolean };
/** An error can carry `undo` when an Undo failed and may be tried again. */
export type FieldStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; note?: string; undo?: () => Promise<FieldSaveResult> }
  | { state: "error"; message: string; fields?: Array<{ path: string; message: string }>; undo?: () => Promise<FieldSaveResult> };

const SAVED_MS = 3500;
const UNDO_MS = 12000;

/** What a panel knows about the values edited inside it: the saves in flight, and which values hold unsaved changes. */
type PanelEditsValue = { track: (save: Promise<unknown>) => void; register: (dirty: () => boolean) => () => void };
export const PanelEdits = createContext<PanelEditsValue | null>(null);

/**
 * For a panel (the event view, the trip details): every value and section edited inside it (through `PanelEdits`)
 * reports its saves in flight and whether it holds an unsaved change. Before the panel closes or moves on, it waits for
 * the saves (`settle`) and then asks only if something is still unsaved (`dirty`), so a save that is about to land is
 * never offered for discarding. Both read the current state, not the last render.
 */
export function usePanelEdits() {
  const [edits] = useState(() => {
    const pending = new Set<Promise<unknown>>();
    const parts = new Set<() => boolean>();
    return {
      track(save: Promise<unknown>) {
        pending.add(save);
        const done = () => void pending.delete(save);
        save.then(done, done);
      },
      register(dirty: () => boolean) {
        parts.add(dirty);
        return () => void parts.delete(dirty);
      },
      busy: () => pending.size > 0,
      dirty: () => [...parts].some((isDirty) => isDirty()),
      async settle() {
        while (pending.size) await Promise.allSettled([...pending]);
      },
    };
  });
  return edits;
}

/**
 * One value edited where it is shown (TRIP-10, DASH-6): open it, change it, and leaving it, Enter or picking a value
 * saves; Escape goes back to the saved value. The save gets the draft and the value it started from, so it can send
 * that as the field's starting value. A failed save keeps the draft open with its error. Also used for a section edited
 * as a group, whose Save and Cancel call `commit` and `cancel`. Inside a panel it reports its saves and unsaved changes.
 */
export function useInlineField<T>({ read, save, same = sameValue, initiallyOpen = false }: { read: () => T; save: (draft: T, start: T) => Promise<FieldSaveResult>; same?: (a: T, b: T) => boolean; initiallyOpen?: boolean }) {
  const edits = useContext(PanelEdits);
  const [editing, setEditingState] = useState(initiallyOpen);
  const [draft, setDraftState] = useState<T>(read);
  const [status, setStatus] = useState<FieldStatus>({ state: "idle" });
  // Where the edit began: a ref for the save, and state for telling whether there are unsaved changes.
  const start = useRef<T>(draft);
  const [startValue, setStartValue] = useState<T>(draft);
  // The same as `editing` and `draft`, current between renders, for the panel asking whether anything is unsaved.
  const editingNow = useRef(initiallyOpen);
  const draftNow = useRef<T>(draft);
  const busy = useRef(false);

  const setEditing = (value: boolean) => {
    editingNow.current = value;
    setEditingState(value);
  };
  const setDraft = (value: SetStateAction<T>) => {
    const next = typeof value === "function" ? (value as (old: T) => T)(draftNow.current) : value;
    draftNow.current = next;
    setDraftState(next);
  };

  useEffect(() => edits?.register(() => editingNow.current && !same(draftNow.current, start.current)), [edits, same]);

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

  async function commit(value: T = draftNow.current): Promise<boolean> {
    if (busy.current) return false;
    if (same(value, start.current)) {
      setEditing(false);
      setStatus({ state: "idle" });
      return true;
    }
    busy.current = true;
    setStatus({ state: "saving" });
    const pending = save(value, start.current);
    edits?.track(pending);
    const r = await pending;
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

  /** Saves a value straight from the view, without opening the controls (Remove point). */
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

  /** Undoes the last save. A failure says why and, unless the value changed elsewhere meanwhile, offers to try again. */
  async function undo() {
    const fn = status.state === "saved" || status.state === "error" ? status.undo : undefined;
    if (!fn || busy.current) return;
    busy.current = true;
    setStatus({ state: "saving" });
    const pending = fn();
    edits?.track(pending);
    const r = await pending;
    busy.current = false;
    if (r.ok) setStatus({ state: "saved", note: "Undone." });
    else if (r.conflict) setStatus({ state: "error", message: "Couldn't undo: it was changed elsewhere meanwhile (in another tab or window, by someone you share the trip with, or by a connected chat)." });
    else setStatus({ state: "error", message: `Couldn't undo. ${r.message}`, undo: fn });
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
