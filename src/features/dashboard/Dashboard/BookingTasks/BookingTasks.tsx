import Link from "next/link";
import type { BookingTaskDTO } from "@/shared/dto";
import { Card } from "@/components/ui/Card/Card";
import { Section } from "@/components/ui/Section/Section";
import { Task, TaskList } from "@/components/ui/TaskList/TaskList";
import { dueText } from "@/lib/format";

/** BOOK-3: the owner's booking tasks across every trip, earliest book-by date first. */
export function BookingTasks({ tasks }: { tasks: BookingTaskDTO[] }) {
  return (
    <Section title="Still to book" titleId="bookings-title" id="bookings">
      <Card>
        <TaskList>
          {tasks.map((t) => (
            <Task key={t.itemId} overdue={t.state === "overdue"}>
              <Link href={`/trips/${t.tripId}`} data-trip-link={t.tripId}><b>{t.itemTitle}</b></Link> · {t.tripTitle}
              <br />
              {dueText(t.dueDate, t.state)}
            </Task>
          ))}
        </TaskList>
      </Card>
    </Section>
  );
}
