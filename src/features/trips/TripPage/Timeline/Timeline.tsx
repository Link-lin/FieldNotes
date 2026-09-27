import type { PlanItemDTO } from "@/shared/dto";
import { EventRow } from "./EventRow/EventRow";
import styles from "./Timeline.module.css";

type Props = {
  items: PlanItemDTO[];
  /** Stop numbers by item id; rows without one get a plain bullet. */
  numbers: Map<string, { n: number; need: boolean }> | null;
  owner: boolean;
  tripZone: string;
  menuFor: string | null;
  onMenu: (id: string | null) => void;
  onEdit: (item: PlanItemDTO) => void;
  onDuplicate: (item: PlanItemDTO) => void;
  onDelete: (item: PlanItemDTO) => void;
};

/** A vertical line of events in time order. */
export function Timeline({ items, numbers, owner, tripZone, menuFor, onMenu, onEdit, onDuplicate, onDelete }: Props) {
  return (
    <ul className={styles.timeline} data-timeline>
      {items.map((i) => (
        <EventRow
          key={i.id}
          item={i}
          num={numbers?.get(i.id) ?? null}
          owner={owner}
          tripZone={tripZone}
          menuOpen={menuFor === i.id}
          onMenu={(o) => onMenu(o ? i.id : null)}
          onEdit={() => onEdit(i)}
          onDuplicate={() => onDuplicate(i)}
          onDelete={() => onDelete(i)}
        />
      ))}
    </ul>
  );
}
