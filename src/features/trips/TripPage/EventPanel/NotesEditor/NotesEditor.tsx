"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { PlanItemDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { api } from "@/lib/api";
import styles from "./NotesEditor.module.css";

const MAX = 5000;
const DELAY_MS = 800;

type Status = "idle" | "saving" | "saved" | "error" | "conflict";
type Props = { tripId: string; item: PlanItemDTO; onSaved: (item: PlanItemDTO) => void };
export type NotesFlushResult = { ok: true; item?: PlanItemDTO } | { ok: false };
/** `flush` saves what is typed and waits for any save in flight; `pending` says whether there is anything to save or still saving. */
export type NotesEditorHandle = { flush: () => Promise<NotesFlushResult>; pending: () => boolean };

/**
 * TRIP-10: the owner's notes for one event, saved as they type (after a short pause), when the
 * field loses focus and when the panel closes. A failed save keeps the text; notes changed
 * elsewhere are reported instead of being overwritten. A newer version of the event that left the
 * notes alone (a connected chat moved it, TRIP-11) is simply taken on.
 */
export const NotesEditor = forwardRef<NotesEditorHandle, Props>(function NotesEditor({ tripId, item, onSaved }, ref) {
  const id = useId();
  const [text, setText] = useState(item.notes ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Refs so concurrent saves and the exit flush always see the latest values.
  const latest = useRef(text);
  const saved = useRef(item.notes ?? "");
  const version = useRef(item.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<NotesFlushResult> | null>(null);
  const blocked = useRef(false);
  // A newer version of the event (a live update, TRIP-11): its notes, if they changed and nothing is typed here.
  useEffect(() => {
    if (item.version <= version.current) return;
    const theirs = item.notes ?? "";
    if (theirs === saved.current) version.current = item.version;
    else if (latest.current === saved.current && !inFlight.current && !blocked.current) {
      // Nothing typed here since the last save: show the notes as they are now.
      saved.current = theirs;
      latest.current = theirs;
      version.current = item.version;
      setText(theirs);
    }
  }, [item]);

  async function save(): Promise<NotesFlushResult> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current.trim();
    if (blocked.current) return { ok: false };
    if (inFlight.current) {
      const result = await inFlight.current;
      return result.ok ? save() : result;
    }
    if (value === saved.current.trim()) return { ok: true };
    setStatus("saving");
    // `baseNotes` lets the save go through when only the event's other fields changed meanwhile, here or not yet seen.
    const request = api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${item.id}/notes`, { notes: value || null, expectedVersion: version.current, baseNotes: saved.current || null }).then((r): NotesFlushResult => {
      if (r.ok) {
        version.current = r.data.version;
        saved.current = r.data.notes ?? "";
        setStatus(latest.current.trim() === saved.current ? "saved" : "idle");
        setError(null);
        onSaved(r.data);
        return { ok: true, item: r.data };
      }
      if (r.status === 409) {
        blocked.current = true;
        setStatus("conflict");
        setError("These notes were changed elsewhere (in another tab or window, by someone you share the trip with, or by a connected chat), so yours weren't saved. Your text is still here: copy it, close and reopen the event to see the notes as they are now, then add yours again.");
      } else {
        setStatus("error");
        setError(r.message);
      }
      return { ok: false };
    });
    inFlight.current = request;
    const result = await request;
    inFlight.current = null;
    return result.ok && latest.current.trim() !== saved.current.trim() ? save() : result;
  }

  useImperativeHandle(ref, () => ({
    flush: save,
    // Typed and not saved, saving, or held back after a failed or conflicting save.
    pending: () => blocked.current || !!inFlight.current || latest.current.trim() !== saved.current.trim(),
  }));

  // The panel flushes before transitions; cleanup covers an unexpected unmount.
  const flush = useRef(save);
  useEffect(() => {
    flush.current = save;
  });
  useEffect(() => () => void flush.current(), []);

  function onChange(value: string) {
    setText(value);
    latest.current = value;
    if (status !== "conflict") setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), DELAY_MS);
  }

  const near = text.length > MAX - 500;
  return (
    <div className={styles.notes}>
      <label htmlFor={`${id}-notes`} className={styles.label}>Notes</label>
      <textarea
        id={`${id}-notes`}
        className={styles.field}
        value={text}
        maxLength={MAX}
        rows={5}
        placeholder="Opening hours, what to bring, who's meeting where…"
        aria-describedby={`${id}-status`}
        aria-invalid={status === "error" || status === "conflict" ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void save()}
      />
      <div className={styles.foot}>
        <span id={`${id}-status`} role="status" className={styles.status} data-status={status}>
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save." : status === "conflict" ? "Not saved." : "Saves as you type."}
        </span>
        {near ? <span className={styles.count}>{text.length.toLocaleString()} / {MAX.toLocaleString()}</span> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
          {status === "error" ? <Button variant="quiet" onClick={() => void save()}>Try again</Button> : null}
        </p>
      ) : null}
    </div>
  );
});
