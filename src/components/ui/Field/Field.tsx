import { cx } from "@/lib/cx";
import styles from "./Field.module.css";

type FieldProps = {
  label: React.ReactNode;
  /** id of the control the label names. */
  htmlFor?: string;
  hint?: React.ReactNode;
  hintId?: string;
  error?: React.ReactNode;
  errorId?: string;
  /** Span both columns of a FieldGrid. */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * Label, control and one line of help or error. Inputs, selects and textareas inside get the
 * shared control look; give the control aria-invalid and aria-describedby={errorId} on error.
 */
export function Field({ label, htmlFor, hint, hintId, error, errorId, wide, className, children }: FieldProps) {
  return (
    <div className={cx(styles.field, wide && styles.wide, className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className={styles.error} id={errorId}>{error}</span>
      ) : hint ? (
        <p className={styles.hint} id={hintId}>{hint}</p>
      ) : null}
    </div>
  );
}

/** Two columns of fields; one column on narrow screens. */
export function FieldGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx(styles.grid, className)}>{children}</div>;
}

/** A labelled checkbox or radio. */
export function CheckField({ label, className, ...input }: { label: React.ReactNode; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx(styles.check, className)}>
      <input type="checkbox" {...input} /> {label}
    </label>
  );
}

/** The error for a whole form. It can take focus so a failed submit can move focus to it. */
export function FormError({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <p className={cx(styles.formError, className)} id={id} tabIndex={-1} role="alert">
      {children}
    </p>
  );
}

export { styles as fieldStyles };
