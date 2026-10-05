import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import styles from "./DraftsNote.module.css";

/** IMPORT-7: how many of the trip's events are still unverified AI drafts, with one action to mark them all reviewed. */
export function DraftsNote({ count, busy, onReviewAll }: { count: number; busy: boolean; onReviewAll: () => void }) {
  return (
    <Banner tone="info" className={styles.note}>
      <p>
        <b>{count === 1 ? "1 event is an AI draft" : `${count} events are AI drafts`}</b> that nobody has checked yet. Open one to check it, or mark them all
        reviewed once the plan looks right. Prices stay estimates until you confirm them in each event.
      </p>
      <Button data-review-all onClick={onReviewAll} disabled={busy}>{busy ? "Marking…" : count === 1 ? "Mark it reviewed" : "Mark all reviewed"}</Button>
    </Banner>
  );
}
