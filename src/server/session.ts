import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { actorFor, type Actor } from "./actor";
import { HttpError } from "./http";

export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return actorFor({ id: user.id, email: user.email });
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return actor;
}

/** For server pages: a signed-out request goes to sign-in (never throws a 401 into the page). */
export async function pageActor(path: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect(`/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  return actor;
}
