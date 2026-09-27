import { publicRoute } from "@/server/core/http/route";
import { appOrigin } from "@/server/core/env";
import { json } from "@/server/core/http/respond";
import { stageInvitation } from "@/server/modules/invitations/invitations.service";
import { stageCookie } from "@/server/modules/invitations/invitations.rules";
import { invitationStageSchema } from "@/shared/schemas";

/**
 * The invite page sends the token from the link's fragment here before sign-in. A usable link sets a
 * 15-minute HttpOnly cookie holding only its hash, so it survives the Google sign-in round trip.
 */
export const POST = publicRoute({ body: invitationStageSchema }, async ({ db, body }) => {
  const hash = await stageInvitation(db, body.token);
  const res = json({ staged: true });
  res.headers.append("Set-Cookie", stageCookie(appOrigin(), hash));
  return res;
});
