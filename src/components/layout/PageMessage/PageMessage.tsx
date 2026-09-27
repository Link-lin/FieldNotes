import styles from "./PageMessage.module.css";

/** A whole-page message such as "Trip not found", with an optional action under it. */
export function PageMessage({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.body}>
        <h1>{title}</h1>
        <p className="note">{children}</p>
        {action}
      </div>
    </main>
  );
}
