import Link from "next/link";
import { Logo } from "@/components/ui/Logo/Logo";
import { AccountMenu } from "./AccountMenu/AccountMenu";
import styles from "./AppHeader.module.css";

type Props = {
  name: string;
  email: string;
  /** Trips where you are an owner (created, or given the role); the rest are ones you are invited to. */
  ownedCount: number;
  sharedCount: number;
  signOut: () => Promise<void>;
};

/** Top bar: logo, atlas link and the account menu. Booking work lives inside each trip. */
export function AppHeader({ name, email, ownedCount, sharedCount, signOut }: Props) {
  return (
    <header className={styles.header}>
      <Logo href="/" />
      <div className={styles.right}>
        <nav className={`mono ${styles.nav}`} aria-label="Main">
          <Link href="/" className={styles.atlas}>Atlas</Link>
        </nav>
        <AccountMenu name={name} email={email} ownedCount={ownedCount} sharedCount={sharedCount} signOut={signOut} />
      </div>
    </header>
  );
}
