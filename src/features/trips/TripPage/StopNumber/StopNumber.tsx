import { cx } from "@/lib/cx";
import styles from "./StopNumber.module.css";

/** The round number shared by a timeline row, its pin and its stop-list line. Vermilion when still to book. */
export function StopNumber({ n, need, className }: { n: number; need?: boolean; className?: string }) {
  return <span className={cx(styles.num, need && styles.need, className)}>{n}</span>;
}
