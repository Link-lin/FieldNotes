import { headers } from "next/headers";
import NextAuth from "next-auth";
import { getDb } from "@/server/core/db/client";
import { appOrigin } from "@/server/core/env";
import { authConfig } from "@/server/auth/config";

/** Sign-in for the whole app; the configuration lives in `config.ts` so it can be tested without Next.js. */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  // Build callback URLs from the configured origin, never from the request's Host header.
  process.env.AUTH_URL ??= appOrigin();
  return authConfig(getDb(), async () => {
    try {
      return (await headers()).get("cookie");
    } catch {
      return null; // outside a request there are no cookies to read
    }
  });
});
