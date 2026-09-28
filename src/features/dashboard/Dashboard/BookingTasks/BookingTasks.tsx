"use client";

import { useRouter } from "next/navigation";
import type { BookingTaskDTO } from "@/shared/dto";
import { Card } from "@/components/ui/Card/Card";
import { Section } from "@/components/ui/Section/Section";
import { TaskList } from "@/components/ui/TaskList/TaskList";
import { BookingTask } from "@/features/trips/BookingTask/BookingTask";
import { isPhoneWidth } from "@/lib/client-value";

/**
 * BOOK-3: the owner's booking tasks across every trip, earliest book-by date first. A task opens
 * its event over the trip page (on phones, the event's own page) and can be booked or dated here.
 */
export function BookingTasks({ tasks }: { tasks: BookingTaskDTO[] }) {
  const router = useRouter();
  return (
    <Section title="Still to book" titleId="bookings-title" id="bookings">
      <Card>
        <TaskList>
          {tasks.map((t) => (
            <BookingTask
              key={t.itemId}
              task={t}
              owner
              showTrip
              href={`/trips/${t.tripId}?event=${t.itemId}`}
              onOpen={(e) => {
                if (!isPhoneWidth()) return;
                e.preventDefault();
                router.push(`/trips/${t.tripId}/items/${t.itemId}`);
              }}
              emptyFocus="#list-title"
            />
          ))}
        </TaskList>
      </Card>
    </Section>
  );
}
