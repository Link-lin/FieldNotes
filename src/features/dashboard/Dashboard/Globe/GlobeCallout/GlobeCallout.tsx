import type { TripSummaryDTO } from "@/shared/dto";
import { ButtonLink } from "@/components/ui/Button/Button";
import { StatusIcon } from "@/components/ui/Icon/icons";
import { Tag } from "@/components/ui/Tag/Tag";
import { cx } from "@/lib/cx";
import { dateRangeLabel, STATUS_LABEL } from "@/lib/format";
import styles from "./GlobeCallout.module.css";

const samePoint = (a: TripSummaryDTO, b: TripSummaryDTO) =>
  !!a.atlasLocation && !!b.atlasLocation && a.atlasLocation.latitude.toFixed(2) === b.atlasLocation.latitude.toFixed(2) && a.atlasLocation.longitude.toFixed(2) === b.atlasLocation.longitude.toFixed(2);

/**
 * Card beside the selected marker (ATLAS-2). When trips share the point, it lists them all so
 * none is hidden. The globe positions it; `ref` is its root.
 */
export function GlobeCallout({ ref, selected, trips, onSelect }: { ref: React.Ref<HTMLDivElement>; selected: TripSummaryDTO; trips: TripSummaryDTO[]; onSelect: (id: string) => void }) {
  const same = trips.filter((t) => samePoint(t, selected));
  const setBy = selected.atlasLocation?.source === "owner" ? (selected.role === "owner" ? "Point set by you" : "Point set by the trip owner") : "Approximate destination";
  return (
    <div className={styles.callout} ref={ref}>
      {same.length > 1 ? (
        <>
          <div className="mono muted">{same.length} trips share this point</div>
          <div className={styles.list}>
            {same.map((o) => (
              <button key={o.id} type="button" aria-current={o.id === selected.id} onClick={() => onSelect(o.id)}>
                <b>{o.title}</b>
                <small>{dateRangeLabel(o)}</small>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <h3 className={styles.title}>{selected.title}</h3>
      <div className="mono muted">{dateRangeLabel(selected)}</div>
      <div className={styles.actions}>
        <Tag tone={selected.status}><StatusIcon status={selected.status} />{STATUS_LABEL[selected.status]}</Tag>
        <ButtonLink variant="fill" href={`/trips/${selected.id}`} data-trip-link={selected.id}>Open trip</ButtonLink>
      </div>
      <div className={cx("muted")}>{setBy}</div>
    </div>
  );
}
