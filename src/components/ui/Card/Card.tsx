import { cx } from "@/lib/cx";
import styles from "./Card.module.css";

/** A raised paper surface. */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.card, className)} {...rest}>{children}</div>;
}
