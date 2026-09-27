import { cx } from "@/lib/cx";
import styles from "./GlobeLoading.module.css";

/** Shown in the globe's place while its code loads; the trip list is already usable. */
export function GlobeLoading({ className }: { className?: string }) {
  return (
    <section className={cx(styles.loading, className)} aria-label="Globe">
      <p className={cx("mono", styles.text)}>Loading the globe…</p>
    </section>
  );
}
