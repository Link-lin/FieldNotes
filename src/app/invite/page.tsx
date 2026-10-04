import { headers } from "next/headers";
import { appleEnabled } from "@/server/auth/apple";
import { auth, signIn, signOut } from "@/server/auth/auth";
import { wechatEnabled } from "@/server/auth/wechat";
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

  async function apple() {
    "use server";
    await signIn("apple", { redirectTo: "/invite" });
  }

  async function wechat() {
    "use server";
    await signIn("wechat", { redirectTo: "/invite" });
  }

  async function switchAccount() {
    "use server";
    await signOut({ redirect: false });
    await signIn("google", { redirectTo: "/invite" });
  }

  // WeChat's own browser can't reach Google, so a visitor inside it sees WeChat first.
  const inWeChat = /MicroMessenger/i.test((await headers()).get("user-agent") ?? "");
  return (
    <InvitePage
      signedIn={Boolean(session?.user)}
      signIn={google}
      signInApple={appleEnabled() ? apple : undefined}
      signInWeChat={wechatEnabled() ? wechat : undefined}
      wechatFirst={inWeChat}
      switchAccount={switchAccount}
    />
  );
}
