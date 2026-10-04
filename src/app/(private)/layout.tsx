import { appleEnabled } from "@/server/auth/apple";
import { signIn, signOut } from "@/server/auth/auth";
import { wechatEnabled } from "@/server/auth/wechat";
import { getDb } from "@/server/core/db/client";
import { connectorEnabled } from "@/server/core/env";
import { connectorUrls } from "@/server/modules/oauth/oauth.metadata";
import { currentSession, pageActor } from "@/server/auth/session";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { AppHeader } from "@/components/layout/AppHeader/AppHeader";
import { AppShell } from "@/components/layout/AppShell/AppShell";
import { ToastProvider } from "@/components/ui/Toast/Toast";

export const dynamic = "force-dynamic";

/** Signed-in shell. A redirect here is a convenience; every page and route re-checks access. */
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor();
  const user = (await currentSession())?.user;
  const dash = await getDashboard(getDb(), actor);
  // Offer "Sign-in methods" only when there is more than one to choose from.
  const apple = appleEnabled();
  const wechat = wechatEnabled();
  const linked = apple || wechat ? new Set((await getDb().selectFrom("Account").select("provider").where("userId", "=", actor.userId).execute()).map((r) => r.provider)) : null;

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/sign-in?signedOut=1" });
  }

  async function connectGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  async function connectApple() {
    "use server";
    await signIn("apple", { redirectTo: "/" });
  }

  async function connectWeChat() {
    "use server";
    await signIn("wechat", { redirectTo: "/" });
  }

  return (
    <ToastProvider>
      <AppShell
        header={
          <AppHeader
            name={user?.name ?? actor.email ?? "You"}
            email={user?.email ?? actor.email ?? ""}
            ownedCount={dash.trips.filter((t) => t.role === "owner").length}
            sharedCount={dash.trips.filter((t) => t.role !== "owner").length}
            signOut={doSignOut}
            connectorUrl={connectorEnabled() ? connectorUrls().resource : null}
            methods={
              linked
                ? {
                    hasEmail: Boolean(user?.email),
                    options: [
                      { name: "Google", connected: linked.has("google"), connect: connectGoogle },
                      ...(apple ? [{ name: "Apple", connected: linked.has("apple"), connect: connectApple }] : []),
                      ...(wechat ? [{ name: "WeChat", connected: linked.has("wechat"), connect: connectWeChat }] : []),
                    ],
                  }
                : null
            }
          />
        }
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
