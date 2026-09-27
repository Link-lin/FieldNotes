import { PlusIcon } from "@/components/ui/Icon/icons";
import styles from "./AddFab.module.css";

/** The floating "Add to itinerary" button that stays on screen for owners. */
export function AddFab({ onClick }: { onClick: () => void }) {
  return (
    <button className={styles.fab} type="button" data-fab onClick={onClick}>
      <PlusIcon /> Add to itinerary
    </button>
  );
}
