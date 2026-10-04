import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, signOut } from "@/server/auth/auth";
import { getDb } from "@/server/core/db/client";
import { currentActor } from "@/server/auth/session";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { AppHeader } from "@/components/layout/AppHeader/AppHeader";
import { AppShell } from "@/components/layout/AppShell/AppShell";
import { ToastProvider } from "@/components/ui/Toast/Toast";

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
      <AppShell
        header={
          <AppHeader
            name={session.user.name ?? session.user.email ?? "You"}
            email={session.user.email ?? ""}
            ownedTrips={dash.trips.filter((t) => t.primaryOwner).map((t) => t.title)}
            sharedCount={dash.trips.filter((t) => !t.primaryOwner).length}
            signOut={doSignOut}
          />
        }
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
