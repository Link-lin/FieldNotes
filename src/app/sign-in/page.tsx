import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth/auth";
import { wechatEnabled } from "@/server/auth/wechat";
import { appOrigin } from "@/server/core/env";
import { stageCookieName } from "@/server/modules/invitations/invitations.rules";
import { ButtonLink } from "@/components/ui/Button/Button";
import { SignInCard, type SignInState } from "@/features/auth/SignInCard/SignInCard";
import { safePath } from "@/shared/safe-path";

type Search = Promise<{ error?: string; callbackUrl?: string; signedOut?: string; deleted?: string }>;

/**
 * The only public screen (ACCESS-9). It never renders trip data; a deep link is kept
 * only as the redirect target after sign-in.
 */
export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const session = await auth();
  if (session?.user && !sp.error) redirect(safePath(sp.callbackUrl));
  // Someone already signed in who lands here with an error was connecting another sign-in method.
  const connecting = Boolean(session?.user);
  const denied = sp.error === "AccessDenied";
  // A staged invitation (only the cookie's presence is checked) turns a denied sign-in into the
  // invitation's wrong-account state, and switching accounts returns to the invitation.
  const invited = (await cookies()).has(stageCookieName(appOrigin()));
  const target = invited && denied ? "/invite" : safePath(sp.callbackUrl);
  const wrongAccount = sp.error === "OAuthAccountNotLinked";
  const otherError = sp.error && !denied && !wrongAccount;

  async function google() {
    "use server";
    await signIn("google", { redirectTo: target });
  }

  async function wechat() {
    "use server";
    await signIn("wechat", { redirectTo: target });
  }

  // WeChat's own browser can't reach Google, so a visitor inside it sees WeChat first.
  const inWeChat = /MicroMessenger/i.test((await headers()).get("user-agent") ?? "");
  const state: SignInState = connecting
    ? wrongAccount ? "linkFailed" : "error"
    : denied ? (invited ? "inviteWrongAccount" : "denied") : wrongAccount ? "wrongAccount" : otherError ? "error" : sp.deleted ? "deleted" : sp.signedOut ? "signedOut" : null;
  if (connecting) {
    return (
      <SignInCard state={state}>
        <ButtonLink block href="/">Back to Field Notes</ButtonLink>
      </SignInCard>
    );
  }
  return <SignInCard state={state} action={google} wechatAction={wechatEnabled() ? wechat : undefined} wechatFirst={inWeChat} />;
}
