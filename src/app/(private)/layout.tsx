import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { getDb } from "@/server/db";
import { currentActor } from "@/server/session";
import { getDashboard } from "@/server/trips";
import { AccountMenu } from "@/components/AccountMenu";
import { ToastProvider } from "@/components/Toast";
import { GlobeIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

/** Signed-in shell. A redirect here is a convenience; every page and route re-checks access. */
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const actor = await currentActor();
  if (!session?.user || !actor) {
    const path = (await headers()).get("x-pathname") ?? "/";
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  }
  const dash = await getDashboard(getDb(), actor);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/sign-in?signedOut=1" });
  }

  return (
    <ToastProvider>
      <div id="app-root">
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="top">
          <Link className="logo" href="/">
            <i aria-hidden="true"><GlobeIcon /></i>
            <span className="mono">Field Notes</span>
          </Link>
          <div className="top-right">
            <nav className="mono" aria-label="Main">
              <Link href="/">Atlas</Link>
              {actor.isOwner ? (
                <Link href="/#bookings">
                  Bookings <b>{dash.ownerBookingTasks.length}</b>
                </Link>
              ) : null}
            </nav>
            <AccountMenu
              name={session.user.name ?? session.user.email ?? "You"}
              email={session.user.email ?? ""}
              ownedTrips={dash.trips.filter((t) => t.role === "owner").map((t) => t.title)}
              viewerCount={dash.trips.filter((t) => t.role === "viewer").length}
              signOut={doSignOut}
            />
          </div>
        </header>
        <div id="main">{children}</div>
      </div>
    </ToastProvider>
  );
}
