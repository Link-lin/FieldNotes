"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PlanItemDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { api } from "@/lib/api";
import styles from "./NotesEditor.module.css";

const MAX = 5000;
const DELAY_MS = 800;

type Status = "idle" | "saving" | "saved" | "error" | "conflict";
type Props = { tripId: string; item: PlanItemDTO; onSaved: (item: PlanItemDTO) => void };

/**
 * TRIP-10: the owner's notes for one event, saved as they type (after a short pause), when the
 * field loses focus and when the panel closes. A failed save keeps the text; a newer version
 * elsewhere is reported instead of being overwritten.
 */
export function NotesEditor({ tripId, item, onSaved }: Props) {
  const id = useId();
  const [text, setText] = useState(item.notes ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Refs so saves and the unmount flush always see the latest values.
  const latest = useRef(text);
  const saved = useRef(item.notes ?? "");
  const version = useRef(item.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const blocked = useRef(false);

  async function save() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current.trim();
    if (blocked.current || value === saved.current.trim()) return;
    if (busy.current) {
      // One save at a time; try again once this one finishes.
      timer.current = setTimeout(() => void save(), DELAY_MS);
      return;
    }
    busy.current = true;
    setStatus("saving");
    const r = await api<PlanItemDTO>("PATCH", `/api/trips/${tripId}/items/${item.id}/notes`, { notes: value || null, expectedVersion: version.current });
    busy.current = false;
    if (r.ok) {
      version.current = r.data.version;
      saved.current = r.data.notes ?? "";
      setStatus(latest.current.trim() === saved.current ? "saved" : "idle");
      setError(null);
      onSaved(r.data);
      return;
    }
    if (r.status === 409) {
      blocked.current = true;
      setStatus("conflict");
      setError("This event changed in another tab or window, so your notes weren't saved. Your text is still here: copy it, reload the page, then add it again.");
    } else {
      setStatus("error");
      setError(r.message);
    }
  }

  // Save whatever is pending when the panel closes or moves to another event.
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
}
