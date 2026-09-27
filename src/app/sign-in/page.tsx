import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { GlobeIcon } from "@/components/icons";
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
  const target = safePath(sp.callbackUrl);
  const denied = sp.error === "AccessDenied";
  const wrongAccount = sp.error === "OAuthAccountNotLinked";
  const otherError = sp.error && !denied && !wrongAccount;

  async function google() {
    "use server";
    await signIn("google", { redirectTo: target });
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <span className="logo">
          <i aria-hidden="true"><GlobeIcon /></i>
          <span className="mono">Field Notes</span>
        </span>
        <h1>Sign in</h1>
        {denied ? (
          <div className="banner" role="alert">This Google account is not set up for Field Notes. Try another account, or ask the trip owner for an invitation.</div>
        ) : wrongAccount ? (
          <div className="banner" role="alert">That Google account can&apos;t be used here. Switch to the account you normally use for Field Notes.</div>
        ) : otherError ? (
          <div className="banner" role="alert">Sign-in didn&apos;t finish. Try again.</div>
        ) : sp.deleted ? (
          <div className="banner info" role="status">Your account and the trips you owned were deleted.</div>
        ) : sp.signedOut ? (
          <div className="banner info" role="status">You are signed out.</div>
        ) : (
          <p>Your trips are private. Sign in to see them.</p>
        )}
        <form action={google}>
          <button className="pill pill-fill" type="submit">{denied || wrongAccount ? "Switch Google account" : "Continue with Google"}</button>
        </form>
        <p className="note">Only Google sign-in is used. Field Notes doesn&apos;t read your email, calendar or files.</p>
      </div>
    </main>
  );
}
