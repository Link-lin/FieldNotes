import { getDb } from "@/server/core/db/client";
import { handleOAuth, OAuthError, oauthJson, readLimitedText } from "@/server/core/http/oauth";
import { registerClient } from "@/server/modules/oauth/oauth.service";

/** RFC 7591: an AI app registers itself. Public, size- and rate-limited; it reads no cookie. */
export const POST = (req: Request) =>
  handleOAuth(async () => {
    let body: unknown;
    try {
      body = JSON.parse(await readLimitedText(req, 8 * 1024));
    } catch (err) {
      if (err instanceof OAuthError) throw err;
      throw new OAuthError(400, "invalid_client_metadata", "The request body must be JSON.");
    }
    return oauthJson(await registerClient(getDb(), body), 201);
  });
