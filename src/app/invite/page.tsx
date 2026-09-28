import { auth, signIn, signOut } from "@/server/auth/auth";
import { InvitePage } from "@/features/invitations/InvitePage/InvitePage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Field Notes" };

/** Public invitation landing page (ACCESS-9). It renders no trip data and loads no third-party content. */
export default async function InviteRoute() {
  const session = await auth();

  async function google() {
    "use server";
    await signIn("google", { redirectTo: "/invite" });
  }

  async function switchAccount() {
    "use server";
    await signOut({ redirect: false });
    await signIn("google", { redirectTo: "/invite" });
  }

  return <InvitePage signedIn={Boolean(session?.user)} signIn={google} switchAccount={switchAccount} />;
}
