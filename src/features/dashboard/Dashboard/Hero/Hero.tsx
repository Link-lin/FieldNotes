import type { DashboardDTO } from "@/shared/dto";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { PlusIcon } from "@/components/ui/Icon/icons";
import { localToday, useClientValue } from "@/lib/client-value";
import { cx } from "@/lib/cx";
import { fmtShort } from "@/lib/format";
import { Tickets } from "./Tickets/Tickets";
import styles from "./Hero.module.css";

/** A compact heading for existing trips; introductory guidance for an empty dashboard. */
export function Hero({ data, onCreate, className }: { data: DashboardDTO; onCreate: () => void; className?: string }) {
  // The viewer's own calendar date, read in the browser: the server's clock may be in another zone.
  const today = useClientValue<string | null>(localToday, null);
  const hasTrips = data.trips.length > 0;
  return (
    <section className={cx(styles.hero, className)} data-has-trips={hasTrips || undefined}>
      <p className={cx("mono", styles.eyebrow)}>Your atlas{today ? ` · today is ${fmtShort(today)}` : ""}</p>
      <h1 className={styles.title}>
        {hasTrips ? "Your trips" : <>Every trip, on one <em>globe.</em></>}
      </h1>
      {!hasTrips ? <p className={styles.lede}>The places you have been and the places you are going, pinned once and easy to find again. Drag the globe, or pick a trip from the list.</p> : null}
      {data.canCreateTrips ? (
        <div className="cluster">
          <Button variant="fill" onClick={onCreate}>
            <PlusIcon /> New trip
          </Button>
          <ButtonLink href="/import">Create from an AI plan</ButtonLink>
        </div>
      ) : null}
      <Tickets trips={data.trips} />
    </section>
  );
}
