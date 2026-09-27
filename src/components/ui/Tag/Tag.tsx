import { cx } from "@/lib/cx";
import styles from "./Tag.module.css";

export type TagTone = "plain" | "soft" | "upcoming" | "ongoing" | "past" | "need" | "booked" | "price";

/** Small uppercase label for status, role, type and price. Meaning is always in the words too. */
export function Tag({ tone = "plain", className, children }: { tone?: TagTone; className?: string; children: React.ReactNode }) {
  return <span className={cx(styles.tag, styles[tone], className)}>{children}</span>;
}
