import type { FieldStatus } from "@/lib/use-inline-field";
import styles from "./SaveStatus.module.css";

/**
 * The save state of a value or section edited in place, as a polite status: Saving…, Saved (or a note such as "Moved
 * to Tue 17 Nov") with Undo where offered, and the error when `showError` is set.
 */
export function SaveStatus({ id, status, onUndo, showError = false, showSaving = true }: { id?: string; status: FieldStatus; onUndo?: () => void; showError?: boolean; showSaving?: boolean }) {
  return (
    <span id={id} className={styles.status} data-state={status.state} role="status">
      {status.state === "saving" && showSaving ? "Saving…" : null}
      {status.state === "saved" ? (
        <>
          {status.note ?? "Saved"}
          {status.undo && onUndo ? <> <button type="button" className={styles.undo} onClick={onUndo}>Undo</button></> : null}
        </>
      ) : null}
      {status.state === "error" && showError ? status.message : null}
    </span>
  );
}
