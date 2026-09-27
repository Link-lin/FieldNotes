import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { KyselyAdapter } from "@auth/kysely-adapter";
import type { Kysely } from "kysely";
import type { Database as AuthDatabase } from "@auth/kysely-adapter";
import { getDb } from "@/server/core/db/client";
import { appOrigin } from "@/server/core/env";
import { allowSignIn } from "@/server/auth/sign-in-gate";

/**
 * Google sign-in with database sessions (ACCESS-1). New accounts are limited to the
 * owner allowlist or a pending, unexpired invitation; an already-linked Google subject
 * may always reauthenticate (account management only; trip access is checked per request).
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  // Build callback URLs from the configured origin, never from the request's Host header.
  process.env.AUTH_URL ??= appOrigin();
  const db = getDb();
  return {
    adapter: KyselyAdapter(db as unknown as Kysely<AuthDatabase>),
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    providers: [
      Google({
        authorization: { params: { prompt: "select_account" } },
        // Keep only the identity fields; no Google API is called after sign-in.
        account: () => ({}),
      }),
    ],
    pages: { signIn: "/sign-in", error: "/sign-in" },
    callbacks: {
      async signIn({ account, profile }) {
        return allowSignIn(db, {
          provider: account?.provider,
          providerAccountId: account?.providerAccountId,
          email: profile?.email,
          emailVerified: profile?.email_verified,
        });
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
});
