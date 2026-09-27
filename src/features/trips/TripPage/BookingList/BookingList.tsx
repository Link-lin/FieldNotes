import type { PlanItemDTO } from "@/shared/dto";
import { Card } from "@/components/ui/Card/Card";
import { Section } from "@/components/ui/Section/Section";
import { Task, TaskList } from "@/components/ui/TaskList/TaskList";
import { dueText } from "@/lib/format";

/** BOOK-1: this trip's events still to book, earliest book-by date first. Read-only for viewers. */
export function BookingList({ items, owner, ownerName }: { items: PlanItemDTO[]; owner: boolean; ownerName: string | null }) {
  const toBook = items.filter((i) => i.bookingStatus === "needs_booking").sort((a, b) => ((a.bookingDueDate ?? "9999") < (b.bookingDueDate ?? "9999") ? -1 : 1));
  return (
    <Section title="Still to book" titleId="book-title">
      <Card>
        <TaskList>
          {!owner ? <p className="note">Read only. {ownerName ?? "The owner"} manages the bookings.</p> : null}
          {!toBook.length ? <p className="note">Nothing waiting to be booked.</p> : null}
          {toBook.map((i) => (
            <Task key={i.id} overdue={i.bookingDueState === "overdue"}>
              <b>{i.title}</b>
              <br />
              {dueText(i.bookingDueDate, i.bookingDueState ?? "no_due_date")}
            </Task>
          ))}
        </TaskList>
      </Card>
    </Section>
  );
}
