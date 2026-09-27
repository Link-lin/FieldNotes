import { ClockIcon, WarnIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import styles from "./TaskList.module.css";

/** A list of to-dos with a clock icon, or a warning icon and bold text when overdue. */
export function TaskList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx(styles.list, className)}>{children}</div>;
}

export function Task({ overdue, children }: { overdue?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx(styles.task, overdue && styles.overdue)}>
      {overdue ? <WarnIcon /> : <ClockIcon />}
      <span>{children}</span>
    </div>
  );
}
