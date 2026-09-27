import "server-only";
import type { Kysely } from "kysely";
import type { z } from "zod";
import { requireOwnerAccount } from "@/server/auth/access";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { getDb } from "@/server/core/db/client";
import type { DB } from "@/server/core/db/schema";
import { assertSameOrigin, readJson } from "./request";
import { handle, json, noContent } from "./respond";

type Options<S extends z.ZodType | undefined> = {
  /** Only allowlisted owners may call it. Per-trip checks stay in the services (server/auth/access.ts). */
  ownerAccount?: boolean;
  /** JSON body schema: the body is size-limited, parsed and validated before the handler runs. */
  body?: S;
  /** Status for a successful response with data (default 200). */
  status?: number;
};

type Context<P, S> = {
  actor: Actor;
  db: Kysely<DB>;
  params: P;
  body: S extends z.ZodType ? z.infer<S> : undefined;
  req: Request;
};

/**
 * Wraps a Route Handler. Every request needs a signed-in session (401 otherwise); every
 * state-changing method must come from the app's own origin (403); a body is read and validated
 * (413, 400, 422); errors become the stable JSON error body; responses are never cached.
 * The handler returns data (sent as JSON), nothing (204) or its own Response.
 */
export function route<P extends Record<string, string> = Record<string, never>, S extends z.ZodType | undefined = undefined>(
  options: Options<S>,
  handler: (ctx: Context<P, S>) => Promise<unknown>,
) {
  return (req: Request, ctx?: { params: Promise<P> }): Promise<Response> =>
    handle(async () => {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const actor = await requireActor();
      if (options.ownerAccount) requireOwnerAccount(actor);
      const body = (options.body ? await readJson(req, options.body) : undefined) as Context<P, S>["body"];
      const params = (ctx ? await ctx.params : {}) as P;
      const result = await handler({ actor, db: getDb(), params, body, req });
      if (result instanceof Response) return result;
      return result === undefined ? noContent() : json(result, options.status ?? 200);
    });
}

/**
 * A Route Handler that needs no session: only invitation staging, which runs before Google sign-in
 * (ACCESS-7: it returns no trip data). Every other rule of `route()` applies: the Origin check on
 * state-changing methods, the body limit and validation, the stable error body and no caching.
 */
export function publicRoute<S extends z.ZodType>(options: { body: S }, handler: (ctx: { db: Kysely<DB>; body: z.infer<S>; req: Request }) => Promise<unknown>) {
  return (req: Request): Promise<Response> =>
    handle(async () => {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const body = await readJson(req, options.body);
      const result = await handler({ db: getDb(), body, req });
      if (result instanceof Response) return result;
      return result === undefined ? noContent() : json(result);
    });
}
