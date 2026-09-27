import { cx } from "@/lib/cx";
import styles from "./Section.module.css";

/** A titled block of a page: small uppercase title, then the content. */
export function Section({ title, titleId, id, className, children }: { title: React.ReactNode; titleId: string; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cx(styles.section, className)} id={id} aria-labelledby={titleId}>
      <h3 className={styles.title} id={titleId}>{title}</h3>
      {children}
    </section>
  );
}
