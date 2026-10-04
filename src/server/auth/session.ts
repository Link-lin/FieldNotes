import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { actorFor, type Actor } from "@/server/auth/actor";
import { HttpError } from "@/server/core/http/errors";
import { safePath } from "@/shared/safe-path";

/**
 * The session, looked up once per server render: the layout, the page and its metadata share it.
 * Outside a render (Route Handlers) React's cache does not memoize, so each request reads it again.
 */
export const currentSession = cache(() => auth());

/** One Actor object per render, so request-scoped caches keyed by it are shared too. */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await currentSession();
  const user = session?.user;
  if (!user?.id) return null;
  return actorFor({ id: user.id, email: user.email ?? null });
});

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return actor;
}

/** The requested path and query (set by src/proxy.ts), kept as the post-sign-in destination. */
export async function returnPath(): Promise<string> {
  return safePath((await headers()).get("x-return-path"));
}

/** For server pages and layouts: a signed-out request goes to sign-in (never throws a 401 into the page). */
export async function pageActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect(`/sign-in?callbackUrl=${encodeURIComponent(await returnPath())}`);
  return actor;
}
