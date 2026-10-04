import "server-only";
import { customFetch, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { KyselyAdapter } from "@auth/kysely-adapter";
import type { Kysely } from "kysely";
import type { Database as AuthDatabase } from "@auth/kysely-adapter";
import type { DB } from "@/server/core/db/schema";
import { appOrigin } from "@/server/core/env";
import { stagedHash } from "@/server/modules/invitations/invitations.rules";
import { appleEnabled, appleProvider } from "@/server/auth/apple";
import type { EmailClaims } from "@/server/auth/identity";
import { adoptVerifiedEmail } from "@/server/auth/link-account";
import { allowSignIn, signedInUserId } from "@/server/auth/sign-in-gate";
import { weChatFetch, wechatEnabled, wechatProvider } from "@/server/auth/wechat";

/**
 * Sign-in with database sessions (ACCESS-1): Google, and Apple and WeChat when the host has set them up. New accounts
 * are limited by the sign-in gate to the owner allowlist or an invitation; an already-linked identity may always
 * reauthenticate (account management only; trip access is checked per request), and someone signed in can connect
 * another method to their account. `cookieHeader` supplies the request's cookies to the gate (the invitation
 * staging cookie and the session cookie travel with the sign-in callback).
 */
export function authConfig(db: Kysely<DB>, cookieHeader: () => Promise<string | null>): NextAuthConfig {
  // The sign-in callback sees the provider's own claims, but the linkAccount event only gets Auth.js's mapped profile,
  // which has no `email_verified`. A configuration is built per request, so this carries the claims from one to the other.
  let claims: EmailClaims = {};
  return {
    adapter: KyselyAdapter(db as unknown as Kysely<AuthDatabase>),
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    providers: [
      Google({
        authorization: { params: { prompt: "select_account" } },
        // Keep only the identity fields; no Google API is called after sign-in.
        account: () => ({}),
      }),
      ...(appleEnabled() ? [appleProvider()] : []),
      ...(wechatEnabled() ? [{ ...wechatProvider(), [customFetch]: weChatFetch, account: () => ({}) }] : []),
    ],
    pages: { signIn: "/sign-in", error: "/sign-in" },
    callbacks: {
      async signIn({ account, profile }) {
        claims = profile ?? {};
        const origin = appOrigin();
        const cookies = await cookieHeader();
        return allowSignIn(db, {
          provider: account?.provider,
          providerAccountId: account?.providerAccountId,
          email: profile?.email,
          emailVerified: profile?.email_verified,
          emailPrivate: profile?.is_private_email,
          stagedHash: stagedHash(origin, cookies),
          signedInUserId: await signedInUserId(db, origin, cookies),
        });
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      async linkAccount({ user, account }) {
        if (user.id) await adoptVerifiedEmail(db, user.id, account.provider, claims);
      },
    },
  };
}
