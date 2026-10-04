import { z } from "zod";
import { HttpError } from "@/server/core/http/errors";
import { requireConnector } from "@/server/core/http/oauth";
import { route } from "@/server/core/http/route";
import { AuthorizationPageError, AuthorizationRedirectError, decideAuthorization } from "@/server/modules/oauth/oauth.service";

/** The consent page's decision on an authorization request (CONNECT-2): the request's own parameters plus allow or deny. */
const body = z
  .object({
    client_id: z.string().max(100),
    redirect_uri: z.string().max(2048),
    response_type: z.string().max(40),
    state: z.string().max(1024).optional(),
    scope: z.string().max(200).optional(),
    code_challenge: z.string().max(200),
    code_challenge_method: z.string().max(20),
    resource: z.string().max(2048).optional(),
    decision: z.enum(["allow", "deny"]),
    allowChanges: z.boolean(),
  })
  .strict();

export const POST = route({ body }, async ({ actor, db, body }) => {
  requireConnector();
  const { decision, allowChanges, ...params } = body;
  try {
    return await decideAuthorization(db, actor, params, decision, allowChanges);
  } catch (err) {
    if (err instanceof AuthorizationRedirectError) return { redirectTo: err.redirectTo };
    if (err instanceof AuthorizationPageError) throw new HttpError(422, "invalid_authorization_request", err.message);
    throw err;
  }
});
