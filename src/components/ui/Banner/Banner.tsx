import { cx } from "@/lib/cx";
import styles from "./Banner.module.css";

/** A short message on a tinted band: `warn` for problems, `info` for neutral news. */
export function Banner({ tone = "warn", className, children, ...rest }: { tone?: "warn" | "info" } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.banner, styles[tone], className)} {...rest}>{children}</div>;
}
