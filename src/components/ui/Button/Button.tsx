import Link from "next/link";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

export type ButtonVariant = "outline" | "fill" | "quiet" | "danger" | "dangerFill" | "link";
type Look = { variant?: ButtonVariant; size?: "md" | "lg"; block?: boolean };

function classes({ variant = "outline", size = "md", block }: Look, extra?: string) {
  return cx(styles.button, styles[variant], size === "lg" && styles.lg, block && styles.block, extra);
}

/** The app's button. `outline` is the default pill; `link` looks like a text link. */
export function Button({ variant, size, block, className, type = "button", ...rest }: Look & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classes({ variant, size, block }, className)} {...rest} />;
}

type LinkProps = Look & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; external?: boolean };

/** A link that looks like a Button. `external` opens in a new tab without sharing the opener. */
export function ButtonLink({ variant, size, block, className, href, external, ...rest }: LinkProps) {
  const cls = classes({ variant, size, block }, className);
  if (external) return <a className={cls} href={href} target="_blank" rel="noopener noreferrer" {...rest} />;
  return <Link className={cls} href={href} {...rest} />;
}
