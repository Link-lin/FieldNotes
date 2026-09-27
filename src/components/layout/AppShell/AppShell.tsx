import styles from "./AppShell.module.css";

/**
 * Signed-in page frame: skip link, header, main region. `#app-root` is made inert while a dialog
 * is open. A screen that must fit the window (the dashboard) marks itself with data-one-screen.
 */
export function AppShell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id="app-root" className={styles.shell}>
      <a className={styles.skipLink} href="#main">Skip to content</a>
      {header}
      <div id="main" className={styles.main}>{children}</div>
    </div>
  );
}
