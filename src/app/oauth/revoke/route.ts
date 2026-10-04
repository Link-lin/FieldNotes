import { getDb } from "@/server/core/db/client";
import { handleOAuth, oauthJson, readFormBody } from "@/server/core/http/oauth";
import { revokeToken } from "@/server/modules/oauth/oauth.service";

/** RFC 7009: the app that holds a token ends its approval. Always 200 for a well-formed request. */
export const POST = (req: Request) =>
  handleOAuth(async () => {
    await revokeToken(getDb(), await readFormBody(req));
    return oauthJson({});
  });
