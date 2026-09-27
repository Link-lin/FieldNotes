import { cx } from "@/lib/cx";
import styles from "./ProgressBar.module.css";

/** A thin bar filled to `value` (0 to 1). Decorative: the same number is always said in words nearby. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className={cx(styles.bar, className)} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}
