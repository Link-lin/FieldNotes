import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Logo } from "@/components/ui/Logo/Logo";
import styles from "./SignInCard.module.css";

export type SignInState =
  | "denied"
  | "wrongAccount"
  | "linkFailed"
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
const WECHAT = "Continue with WeChat";
const SWITCH = "Switch Google account";

/**
 * Invitation states say only that an invitation exists: never the trip, its owner or the invited
 * email (ACCESS-9).
 */
const COPY: Record<Exclude<SignInState, null> | "ready", Copy> = {
  ready: { title: "Sign in", lead: "Your trips are private. Sign in to see them.", button: SIGN_IN },
  denied: {
    title: "Sign in",
    banner: { tone: "warn", text: "This account is not set up for Field Notes. Try another account, or ask the trip owner for an invitation." },
    button: SWITCH,
  },
  wrongAccount: {
    title: "Sign in",
    banner: { tone: "warn", text: "That Google account can't be used here. Switch to the account you normally use for Field Notes." },
    button: SWITCH,
  },
  linkFailed: { title: "Sign in", banner: { tone: "warn", text: "That sign-in is already connected to a different Field Notes account, so it wasn't added to this one." } },
  error: { title: "Sign in", banner: { tone: "warn", text: "Sign-in didn't finish. Try again." }, button: SIGN_IN },
  deleted: { title: "Sign in", banner: { tone: "info", text: "Your account was deleted. Trips that another owner keeps stay with them; any others you owned were deleted." }, button: SIGN_IN },
  signedOut: { title: "Sign in", banner: { tone: "info", text: "You are signed out." }, button: SIGN_IN },
  invited: {
    title: "You're invited",
    lead: "You've been invited to a trip on Field Notes. Sign in to join it. If the invitation was sent to your email, use that Google account.",
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

/** States that offer a way to sign in; the others are about switching Google accounts, or have nothing to sign in to. */
const OFFERS_WECHAT: ReadonlyArray<SignInState | "ready"> = ["ready", "denied", "error", "deleted", "signedOut", "invited"];

type Props = {
  state: SignInState;
  /** The server action behind the Google button; states without a button ignore it. */
  action?: () => Promise<void>;
  /** The server action behind the WeChat button; given only when the host has set WeChat up. */
  wechatAction?: () => Promise<void>;
  /** Put WeChat first: the visitor is inside WeChat's own browser, where Google can't be reached. */
  wechatFirst?: boolean;
  /** Extra actions under the card's main button. */
  children?: React.ReactNode;
};

/** ACCESS-9: the public sign-in and invitation screens. They never show trip data. */
export function SignInCard({ state, action, wechatAction, wechatFirst, children }: Props) {
  const c = COPY[state ?? "ready"];
  const google = c.button && action ? { label: c.button, action } : null;
  const wechat = wechatAction && OFFERS_WECHAT.includes(state ?? "ready") ? { label: WECHAT, action: wechatAction } : null;
  const buttons = wechatFirst ? [wechat, google] : [google, wechat];
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
        {buttons.flatMap((b, i) =>
          b ? (
            <form key={b.label} action={b.action}>
              <Button variant={i === 0 || !buttons[0] ? "fill" : "outline"} size="lg" block type="submit">{b.label}</Button>
            </form>
          ) : [],
        )}
        {children}
        <p className="note">
          {buttons.some(Boolean) ? (wechatAction ? "Sign in with Google or WeChat. " : "Only Google sign-in is used. ") : ""}Field Notes doesn&apos;t read your email, contacts, calendar or files.
        </p>
      </div>
    </main>
  );
}
