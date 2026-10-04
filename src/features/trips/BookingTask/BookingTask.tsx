"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { BookingTaskDTO, PlanItemDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Task } from "@/components/ui/TaskList/TaskList";
import { useToast } from "@/components/ui/Toast/Toast";
import { api } from "@/lib/api";
import { dueText, fmtShort } from "@/lib/format";
import styles from "./BookingTask.module.css";

/** A booking task as the trip page shows it: its item's version for the actions, and whether FLIGHT-2 allows Booked. */
export type BookingRow = BookingTaskDTO & { itemVersion: number; canMarkBooked: boolean };

type Props = {
  task: BookingRow;
  canEdit: boolean;
  onOpen: () => void;
  onDateSaved: (itemId: string, version: number) => void;
  /** Focused when the last task in the list has been marked booked. */
  emptyFocus: string;
};

type Saved = { version: number; dueDate: string | null; state: BookingTaskDTO["state"]; booked: boolean };

/** Focuses an element once a refresh has rendered it, trying for about two seconds. */
function focusSoon(selector: string, tries = 40) {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.focus();
  else if (tries > 0) setTimeout(() => focusSoon(selector, tries - 1), 50);
}

/**
 * BOOK-3, BOOK-4: one task in a booking list. Its title opens the event's view (TRIP-10). Anyone
 * who can edit can mark it booked, with Undo (a flight only once it has its FLIGHT-2 fields), and set, change or
 * remove its book-by date in place. A viewer sees the task only.
 */
export function BookingTask({ task, canEdit, onOpen, onDateSaved, emptyFocus }: Props) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  // The saved result shows at once; the refreshed list replaces it when it arrives.
  const [saved, setSaved] = useState<Saved | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = saved && saved.version > task.itemVersion ? saved : { version: task.itemVersion, dueDate: task.dueDate, state: task.state, booked: false };
  const url = `/api/trips/${task.tripId}/items/${task.itemId}/booking`;
  const dateButton = `[data-due-edit="${task.itemId}"]`;

  async function send(bookingStatus: "needs_booking" | "booked", bookingDueDate: string | null): Promise<PlanItemDTO | null> {
    setBusy(true);
    setError(null);
    const r = await api<PlanItemDTO>("PATCH", url, { bookingStatus, bookingDueDate, expectedVersion: current.version });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      // Changed elsewhere: load the newer version so trying again works.
      if (r.status === 409) router.refresh();
      return null;
    }
    setSaved({ version: r.data.version, dueDate: r.data.bookingDueDate, state: r.data.bookingDueState ?? "no_due_date", booked: r.data.bookingStatus === "booked" });
    return r.data;
  }

  // Once this task leaves the list, focus moves to the next task (or the one before), else the list's fallback.
  function focusAfterBooking(): string {
    const row = document.querySelector(`[data-task="${task.itemId}"]`);
    const next = [row?.nextElementSibling, row?.previousElementSibling].find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.task !== undefined);
    return next ? `[data-task-open="${next.dataset.task}"]` : emptyFocus;
  }

  async function markBooked() {
    if (busy) return;
    const after = focusAfterBooking();
    const dueBefore = current.dueDate;
    const booked = await send("booked", null);
    if (!booked) return;
    router.refresh();
    toast({
      message: `Marked "${task.itemTitle}" booked.`,
      actionLabel: "Undo",
      afterFocus: after,
      onAction: async () => {
        const back = await api<PlanItemDTO>("PATCH", url, { bookingStatus: "needs_booking", bookingDueDate: dueBefore, expectedVersion: booked.version });
        if (!back.ok) {
          toast({ message: back.message });
          return;
        }
        router.refresh();
        toast({ message: `"${task.itemTitle}" is back on the booking list.` });
        focusSoon(`[data-book="${task.itemId}"]`);
      },
    });
  }

  function startEditing() {
    setDraft(current.dueDate ?? "");
    setError(null);
    setEditing(true);
    requestAnimationFrame(() => document.getElementById(`${id}-due`)?.focus());
  }

  function stopEditing() {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(dateButton)?.focus());
  }

  async function saveDate(due: string | null) {
    if (busy) return;
    const done = await send("needs_booking", due);
    if (!done) return;
    setEditing(false);
    onDateSaved(task.itemId, done.version);
    router.refresh();
    toast({ message: due ? `"${task.itemTitle}": book by ${fmtShort(due)}.` : `Book-by date removed from "${task.itemTitle}".` });
  }

  if (current.booked) return null;
  return (
    <Task overdue={current.state === "overdue"} data-task={task.itemId}>
      <p className={styles.head}><button type="button" className={styles.title} data-task-open={task.itemId} onClick={onOpen}>{task.itemTitle}</button></p>
      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft) void saveDate(draft);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            stopEditing();
          }}
        >
          <label htmlFor={`${id}-due`}>Book by</label>
          <input id={`${id}-due`} type="date" value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
          <Button type="submit" variant="fill" className={styles.save} disabled={!draft}>{busy ? "Saving…" : "Save"}</Button>
          {current.dueDate ? <Button variant="quiet" onClick={() => void saveDate(null)}>Remove date</Button> : null}
          <Button variant="quiet" onClick={stopEditing}>Cancel</Button>
        </form>
      ) : (
        <p className={styles.due}>{dueText(current.dueDate, current.state)}</p>
      )}
      {canEdit && !editing ? (
        <div className={styles.actions}>
          {task.canMarkBooked ? (
            <Button variant="quiet" data-book={task.itemId} onClick={() => void markBooked()} aria-label={`Mark ${task.itemTitle} booked`}>{busy ? "Saving…" : "Mark booked"}</Button>
          ) : (
            <span className={styles.hint}>Add both airports and times to mark it booked.</span>
          )}
          <Button variant="link" data-due-edit={task.itemId} onClick={startEditing} aria-label={`${current.dueDate ? "Change" : "Set"} the book-by date for ${task.itemTitle}`}>
            {current.dueDate ? "Change date" : "Set book-by date"}
          </Button>
        </div>
      ) : null}
      {error ? <p className={styles.error} id={`${id}-error`} role="alert">{error}</p> : null}
    </Task>
  );
}
