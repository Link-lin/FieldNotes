import type { PlanItemDTO } from "@/shared/dto";
import { PlaneIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { cx } from "@/lib/cx";
import { priceText } from "@/lib/format";
import styles from "./FlightCard.module.css";

/** A flight segment as a boarding pass: airline and number, route codes, arrival and price (FLIGHT-1). */
export function FlightCard({ item, className }: { item: PlanItemDTO; className?: string }) {
  const f = item.flightDetails!;
  return (
    <div className={cx(styles.pass, className)}>
      <div className={cx("mono", styles.row)}>
        <span>Flight segment{f.airline || f.flightNumber ? ` · ${[f.airline, f.flightNumber].filter(Boolean).join(" ")}` : ""}</span>
        <span>{item.bookingStatus === "booked" ? "Booked" : "Needs booking"}</span>
      </div>
      <div className={styles.route}>
        <span>{f.departure.airportCode ?? "···"}</span>
        <PlaneIcon />
        <span>{f.arrival.airportCode ?? "···"}</span>
      </div>
      <div className={cx("mono", styles.row, styles.foot)}>
        <span>{item.title}</span>
        {f.arrival.localDateTime ? <span>Arrives {f.arrival.localDateTime.replace("T", " ")}</span> : null}
        {item.plannedPrice ? <span>{priceText(item.plannedPrice)}</span> : null}
      </div>
      {item.source === "ai" ? <div><Tag>AI draft, unverified</Tag></div> : null}
    </div>
  );
}
