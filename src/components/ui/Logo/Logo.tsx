import Link from "next/link";
import { GlobeIcon } from "@/components/ui/Icon/icons";
import styles from "./Logo.module.css";

/** The Field Notes mark. With `href` it is a link (the header); without, plain (sign-in). */
export function Logo({ href }: { href?: string }) {
  const body = (
    <>
      <i aria-hidden="true"><GlobeIcon /></i>
      <span className="mono">Field Notes</span>
    </>
  );
  return href ? <Link className={styles.logo} href={href}>{body}</Link> : <span className={styles.logo}>{body}</span>;
}
