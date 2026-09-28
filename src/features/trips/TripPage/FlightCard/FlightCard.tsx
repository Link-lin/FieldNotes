import type { PlanItemDTO } from "@/shared/dto";
import { PlaneIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { cx } from "@/lib/cx";
import { priceText } from "@/lib/format";
import { titleRestatesRoute } from "../trip-days";
import styles from "./FlightCard.module.css";

/**
 * A flight segment as a boarding pass: airline and number, route codes, arrival and price (FLIGHT-1).
 * A flight with no airport times yet is a slim card with only what is known, not an empty pass, and a
 * title that just restates the route is left out.
 */
export function FlightCard({ item, className }: { item: PlanItemDTO; className?: string }) {
  const f = item.flightDetails!;
  const dep = f.departure.airportCode;
  const arr = f.arrival.airportCode;
  const title = titleRestatesRoute(item.title, dep, arr) ? null : item.title;
  const carrier = [f.airline, f.flightNumber].filter(Boolean).join(" ");
  const status = item.bookingStatus === "booked" ? "Booked" : "Needs booking";
  const ai = item.source === "ai" ? <div><Tag>AI draft, unverified</Tag></div> : null;

  if (!f.departure.localDateTime && !f.arrival.localDateTime) {
    return (
      <div className={cx(styles.pass, styles.slim, className)} data-placeholder>
        <div className={cx("mono", styles.row)}>
          <span className={styles.slimRoute}>
            <PlaneIcon />
            {dep || arr ? `${dep ?? "···"} → ${arr ?? "···"}` : "Airports not set"}
            {carrier ? ` · ${carrier}` : ""}
          </span>
          <span>{status}</span>
        </div>
        {title || item.plannedPrice ? (
          <div className={cx("mono", styles.row)}>
            {title ? <span>{title}</span> : null}
            {item.plannedPrice ? <span>{priceText(item.plannedPrice)}</span> : null}
          </div>
        ) : null}
        {ai}
      </div>
    );
  }

  return (
    <div className={cx(styles.pass, className)}>
      <div className={cx("mono", styles.row)}>
        <span>Flight segment{carrier ? ` · ${carrier}` : ""}</span>
        <span>{status}</span>
      </div>
      <div className={styles.route}>
        <span>{dep ?? "···"}</span>
        <PlaneIcon />
        <span>{arr ?? "···"}</span>
      </div>
      {title || f.arrival.localDateTime || item.plannedPrice ? (
        <div className={cx("mono", styles.row, styles.foot)}>
          {title ? <span>{title}</span> : null}
          {f.arrival.localDateTime ? <span>Arrives {f.arrival.localDateTime.replace("T", " ")}</span> : null}
          {item.plannedPrice ? <span>{priceText(item.plannedPrice)}</span> : null}
        </div>
      ) : null}
      {ai}
    </div>
  );
}
