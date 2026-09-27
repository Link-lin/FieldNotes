import type { PlanItemDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { DaySection } from "../DaySection/DaySection";
import styles from "./RecentlyDeleted.module.css";

/** TRIP-8: events deleted this visit, restorable for 10 minutes even after the undo toast is gone. */
export function RecentlyDeleted({ items, onRestore }: { items: PlanItemDTO[]; onRestore: (item: PlanItemDTO) => void }) {
  return (
    <DaySection title="Recently deleted" titleId="deleted-title" meta="Restorable for 10 minutes">
      <ul className={styles.list}>
        {items.map((i) => (
          <li key={i.id}>
            <span>{i.title}</span>
            <Button variant="link" onClick={() => onRestore(i)} aria-label={`Restore ${i.title}`}>Restore</Button>
          </li>
        ))}
      </ul>
    </DaySection>
  );
}
