import { route } from "@/server/core/http/route";
import { appOrigin } from "@/server/core/env";
import { json } from "@/server/core/http/respond";
import { acceptInvitation } from "@/server/modules/invitations/invitations.service";
import { clearStageCookie, stagedHash } from "@/server/modules/invitations/invitations.rules";

/** ACCESS-4: accept the staged invitation as the signed-in account. The staging cookie is cleared on success. */
export const POST = route({}, async ({ db, actor, req }) => {
  const origin = appOrigin();
  const result = await acceptInvitation(db, actor, stagedHash(origin, req.headers.get("cookie")));
  const res = json(result);
  res.headers.append("Set-Cookie", clearStageCookie(origin));
  return res;
});
