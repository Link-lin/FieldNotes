import type { DashboardDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { PlusIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import { fmtShort, plural } from "@/lib/format";
import { Tickets } from "./Tickets/Tickets";
import styles from "./Hero.module.css";

/** Title, New trip (owners only), the current and next trip, and one line of counts. */
export function Hero({ data, today, onCreate, className }: { data: DashboardDTO; today: string; onCreate: () => void; className?: string }) {
  const count = (s: string) => data.trips.filter((t) => t.status === s).length;
  const tasks = data.ownerBookingTasks;
  const overdue = tasks.filter((t) => t.state === "overdue").length;
  return (
    <section className={cx(styles.hero, className)}>
      <p className={cx("mono", styles.eyebrow)}>Your atlas · today is {fmtShort(today)}</p>
      <h1 className={styles.title}>
        Every trip, on one <em>globe.</em>
      </h1>
      <p className={styles.lede}>The places you have been and the places you are going, pinned once and easy to find again. Drag the globe, or pick a trip from the list.</p>
      {data.canCreateTrips ? (
        <div className="cluster">
          <Button variant="fill" onClick={onCreate}>
            <PlusIcon /> New trip
          </Button>
          <ButtonLink href="/import">Create from an AI plan</ButtonLink>
        </div>
      ) : null}
      <Tickets trips={data.trips} />
      <p className={cx("mono", styles.stats)}>
        {plural(data.trips.length, "trip")} · {count("ongoing")} now · {count("upcoming")} ahead
        {data.canCreateTrips ? <> · {tasks.length} to book{overdue ? <b> ({overdue} overdue)</b> : null}</> : null}
      </p>
    </section>
  );
}
