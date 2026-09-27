import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Logo } from "@/components/ui/Logo/Logo";
import styles from "./SignInCard.module.css";

export type SignInState = "denied" | "wrongAccount" | "error" | "deleted" | "signedOut" | null;

const MESSAGE: Record<Exclude<SignInState, null>, { tone: "warn" | "info"; text: string }> = {
  denied: { tone: "warn", text: "This Google account is not set up for Field Notes. Try another account, or ask the trip owner for an invitation." },
  wrongAccount: { tone: "warn", text: "That Google account can't be used here. Switch to the account you normally use for Field Notes." },
  error: { tone: "warn", text: "Sign-in didn't finish. Try again." },
  deleted: { tone: "info", text: "Your account and the trips you owned were deleted." },
  signedOut: { tone: "info", text: "You are signed out." },
};

/** ACCESS-9: the only public screen. It never shows trip data. */
export function SignInCard({ state, action }: { state: SignInState; action: () => Promise<void> }) {
  const m = state ? MESSAGE[state] : null;
  const switchAccount = state === "denied" || state === "wrongAccount";
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Logo />
        <h1 className={styles.title}>Sign in</h1>
        {m ? (
          <Banner tone={m.tone} role={m.tone === "warn" ? "alert" : "status"}>{m.text}</Banner>
        ) : (
          <p className={styles.lead}>Your trips are private. Sign in to see them.</p>
        )}
        <form action={action}>
          <Button variant="fill" size="lg" block type="submit">{switchAccount ? "Switch Google account" : "Continue with Google"}</Button>
        </form>
        <p className="note">Only Google sign-in is used. Field Notes doesn&apos;t read your email, calendar or files.</p>
      </div>
    </main>
  );
}
