import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Logo } from "@/components/ui/Logo/Logo";
import styles from "./SignInCard.module.css";

export type SignInState =
  | "denied"
  | "wrongAccount"
  | "error"
  | "deleted"
  | "signedOut"
  | "invited"
  | "inviteWrongAccount"
  | "inviteInvalid"
  | "inviteOpening"
  | "inviteError"
  | null;

type Copy = { title: string; lead?: string; banner?: { tone: "warn" | "info"; text: string }; button?: string };

const SIGN_IN = "Continue with Google";
const SWITCH = "Switch Google account";

/**
 * Invitation states say only that an invitation exists: never the trip, its owner or the invited
 * email (ACCESS-9).
 */
const COPY: Record<Exclude<SignInState, null> | "ready", Copy> = {
  ready: { title: "Sign in", lead: "Your trips are private. Sign in to see them.", button: SIGN_IN },
  denied: {
    title: "Sign in",
    banner: { tone: "warn", text: "This Google account is not set up for Field Notes. Try another account, or ask the trip owner for an invitation." },
    button: SWITCH,
  },
  wrongAccount: {
    title: "Sign in",
    banner: { tone: "warn", text: "That Google account can't be used here. Switch to the account you normally use for Field Notes." },
    button: SWITCH,
  },
  error: { title: "Sign in", banner: { tone: "warn", text: "Sign-in didn't finish. Try again." }, button: SIGN_IN },
  deleted: { title: "Sign in", banner: { tone: "info", text: "Your account was deleted. Trips that another owner keeps stay with them; any others you owned were deleted." }, button: SIGN_IN },
  signedOut: { title: "Sign in", banner: { tone: "info", text: "You are signed out." }, button: SIGN_IN },
  invited: {
    title: "You're invited",
    lead: "You've been invited to view a trip on Field Notes. Sign in with the Google account the invitation was sent to.",
    button: SIGN_IN,
  },
  inviteWrongAccount: {
    title: "You're invited",
    banner: { tone: "warn", text: "This invitation is for a different Google account. Switch to the account it was sent to." },
    button: SWITCH,
  },
  inviteInvalid: {
    title: "Invitation",
    banner: { tone: "warn", text: "This invitation link isn't valid any more. It may have expired, been replaced by a newer link, or been revoked. Ask the person who shared the trip for a new link." },
  },
  inviteOpening: { title: "You're invited", lead: "Opening the trip…" },
  inviteError: { title: "Invitation", banner: { tone: "warn", text: "Couldn't reach Field Notes. Check your connection and try again." } },
};

type Props = {
  state: SignInState;
  /** The server action behind the Google button; states without a button ignore it. */
  action?: () => Promise<void>;
  /** Extra actions under the card's main button. */
  children?: React.ReactNode;
};

/** ACCESS-9: the public sign-in and invitation screens. They never show trip data. */
export function SignInCard({ state, action, children }: Props) {
  const c = COPY[state ?? "ready"];
  return (
    <main className={styles.page}>
      <div className={styles.card} aria-busy={state === "inviteOpening" || undefined}>
        <Logo />
        <h1 className={styles.title}>{c.title}</h1>
        {c.banner ? (
          <Banner tone={c.banner.tone} role={c.banner.tone === "warn" ? "alert" : "status"}>{c.banner.text}</Banner>
        ) : (
          <p className={styles.lead} role={state === "inviteOpening" ? "status" : undefined}>{c.lead}</p>
        )}
        {c.button && action ? (
          <form action={action}>
            <Button variant="fill" size="lg" block type="submit">{c.button}</Button>
          </form>
        ) : null}
        {children}
        <p className="note">Only Google sign-in is used. Field Notes doesn&apos;t read your email, calendar or files.</p>
      </div>
    </main>
  );
}
