/** Joins class names, skipping empty ones: cx(styles.a, on && styles.b). */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
