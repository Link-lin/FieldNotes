import type { BookingTaskDTO, PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { flightReadyToBook } from "@/shared/booking";
import { Card } from "@/components/ui/Card/Card";
import { Section } from "@/components/ui/Section/Section";
import { TaskList } from "@/components/ui/TaskList/TaskList";
import { BookingTask } from "@/features/trips/BookingTask/BookingTask";

type Props = { trip: TripDetailDTO["trip"]; items: PlanItemDTO[]; owner: boolean; onOpen: (item: PlanItemDTO) => void };

/**
 * BOOK-3: this trip's events still to book, earliest book-by date first. Each opens its event's view;
 * the owner can also mark it booked or set its book-by date here. Read-only for viewers.
 */
export function BookingList({ trip, items, owner, onOpen }: Props) {
  const toBook = items.filter((i) => i.bookingStatus === "needs_booking").sort((a, b) => ((a.bookingDueDate ?? "9999") < (b.bookingDueDate ?? "9999") ? -1 : 1));
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
    <Section title="Still to book" titleId="book-title">
      <Card>
        <TaskList>
          {!owner ? <p className="note">Read only. {trip.ownerName ?? "The owner"} manages the bookings.</p> : null}
          {!toBook.length ? <p className="note" tabIndex={-1} data-book-empty>Nothing waiting to be booked.</p> : null}
          {toBook.map((i) => (
            <BookingTask key={i.id} task={task(i)} owner={owner} onOpen={() => onOpen(i)} emptyFocus="[data-book-empty]" />
          ))}
        </TaskList>
      </Card>
    </Section>
  );
}
