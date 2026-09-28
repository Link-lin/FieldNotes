"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button/Button";
import { SignInCard, type SignInState } from "@/features/auth/SignInCard/SignInCard";
import { api } from "@/lib/api";

type Props = {
  signedIn: boolean;
  /** Google sign-in that returns to this page. */
  signIn: () => Promise<void>;
  /** Sign out, then Google sign-in with the account chooser, returning to this page. */
  switchAccount: () => Promise<void>;
};

/**
 * ACCESS-3/4/9: the invitation link's landing page. The token is read from the URL fragment (never
 * sent in a request line or referrer), removed from the address bar at once, and exchanged for a
 * short-lived HttpOnly cookie. A signed-in visitor then accepts; others sign in and come back here.
 * No state shows the trip, its owner or the invited email.
 */
export function InvitePage({ signedIn, signIn, switchAccount }: Props) {
  const router = useRouter();
  const [state, setState] = useState<SignInState>("inviteOpening");
  const token = useRef<string | null>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setState("inviteOpening");
    if (token.current) {
      const staged = await api<{ staged: true }>("POST", "/api/invitations/stage", { token: token.current });
      if (!staged.ok) {
        setState(staged.status === 0 || staged.status >= 500 ? "inviteError" : "inviteInvalid");
        return;
      }
      token.current = null;
    }
    if (!signedIn) {
      setState("invited");
      return;
    }
    const accepted = await api<{ tripId: string }>("POST", "/api/invitations/accept");
    if (accepted.ok) {
      router.replace(`/trips/${accepted.data.tripId}`);
      return;
    }
    if (accepted.code === "invitation_wrong_account") setState("inviteWrongAccount");
    else if (accepted.status === 401) setState("invited");
    else if (accepted.status === 0 || accepted.status >= 500) setState("inviteError");
    else setState("inviteInvalid");
  }, [router, signedIn]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      token.current = fragment;
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    void run();
  }, [run]);

  const action = state === "inviteWrongAccount" ? switchAccount : signIn;
  return (
    <SignInCard state={state} action={action}>
      {state === "inviteError" ? (
        <Button block onClick={() => void run()}>Try again</Button>
      ) : state === "inviteInvalid" ? (
        <ButtonLink block href="/">Go to Field Notes</ButtonLink>
      ) : null}
    </SignInCard>
  );
}
