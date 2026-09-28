"use client";

import { useEffect, useRef } from "react";
import type { BookingTaskDTO, PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { flightReadyToBook } from "@/shared/booking";
import { Card } from "@/components/ui/Card/Card";
import { TaskList } from "@/components/ui/TaskList/TaskList";
import { BookingTask } from "@/features/trips/BookingTask/BookingTask";
import styles from "./BookingList.module.css";

type Props = { trip: TripDetailDTO["trip"]; items: PlanItemDTO[]; owner: boolean; onOpen: (item: PlanItemDTO) => void };

/** Booking work for this trip, grouped by urgency and read-only for viewers. */
export function BookingList({ trip, items, owner, onOpen }: Props) {
  const pendingFocus = useRef<{ itemId: string; version: number } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !items.some((item) => item.id === pending.itemId && item.version >= pending.version)) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-due-edit="${CSS.escape(pending.itemId)}"]`)?.focus();
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);
  const toBook = items.filter((i) => i.bookingStatus === "needs_booking").sort((a, b) => (a.bookingDueDate ?? "9999").localeCompare(b.bookingDueDate ?? "9999"));
  const groups = [
    { key: "urgent", title: "Due now", description: "Past due or due today. Handle these first.", items: toBook.filter((i) => i.bookingDueState === "overdue" || i.bookingDueState === "due_today") },
    { key: "upcoming", title: "Coming up", description: "Tasks with a later book-by date.", items: toBook.filter((i) => i.bookingDueState === "upcoming") },
    { key: "undated", title: "No book-by date", description: "Set a date when you know when to book.", items: toBook.filter((i) => !i.bookingDueDate) },
  ].filter((group) => group.items.length);
  const task = (i: PlanItemDTO): BookingTaskDTO => ({
    tripId: trip.id,
    tripTitle: trip.title,
    itemId: i.id,
    itemTitle: i.title,
    itemVersion: i.version,
    dueDate: i.bookingDueDate,
    state: i.bookingDueState ?? "no_due_date",
    canMarkBooked: !i.flightDetails || flightReadyToBook(i.flightDetails),
  });
  return (
    <section className={styles.overview} id="bookings" aria-labelledby="bookings-title">
      <div className={styles.intro}>
        <p className="mono">For this trip</p>
        <h2 id="bookings-title" tabIndex={-1}>Bookings</h2>
        <p>{toBook.length ? `${toBook.length} ${toBook.length === 1 ? "item needs" : "items need"} booking. Keep dates and booking status here; open an event for its details.` : items.length ? "No booking tasks right now." : "No events yet, so there is nothing to book."}</p>
        {!owner ? <p className="note">Read only. {trip.ownerName ?? "The owner"} manages the bookings.</p> : null}
      </div>
      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.key} className={styles.group} aria-labelledby={`booking-${group.key}`}>
            <div className={styles.groupHead}>
              <h3 id={`booking-${group.key}`}>{group.title}</h3>
              <span className="mono">{group.items.length}</span>
            </div>
            <p className={styles.hint}>{group.description}</p>
            <Card className={styles.card}>
              <TaskList className={styles.tasks}>
                {group.items.map((i) => (
                  <BookingTask key={i.id} task={task(i)} owner={owner} onOpen={() => onOpen(i)} onDateSaved={(itemId, version) => { pendingFocus.current = { itemId, version }; }} emptyFocus="#bookings-title" />
                ))}
              </TaskList>
            </Card>
          </section>
        ))}
      </div>
    </section>
  );
}
