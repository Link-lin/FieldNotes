import Link from "next/link";
import { Logo } from "@/components/ui/Logo/Logo";
import { AccountMenu } from "./AccountMenu/AccountMenu";
import styles from "./AppHeader.module.css";

type Props = {
  name: string;
  email: string;
  isOwner: boolean;
  bookingCount: number;
  ownedTrips: string[];
  viewerCount: number;
  signOut: () => Promise<void>;
};

/** Top bar: logo, main navigation (Atlas, Bookings for owners) and the account menu. */
export function AppHeader({ name, email, isOwner, bookingCount, ownedTrips, viewerCount, signOut }: Props) {
  return (
    <header className={styles.header}>
      <Logo href="/" />
      <div className={styles.right}>
        <nav className={`mono ${styles.nav}`} aria-label="Main">
          <Link href="/" className={styles.atlas}>Atlas</Link>
          {isOwner ? (
            <Link href="/#bookings">
              Bookings <b>{bookingCount}</b>
            </Link>
          ) : null}
        </nav>
        <AccountMenu name={name} email={email} ownedTrips={ownedTrips} viewerCount={viewerCount} signOut={signOut} />
      </div>
    </header>
  );
}
