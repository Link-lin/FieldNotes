import { getDb } from "@/server/core/db/client";
import { handleOAuth, oauthJson, readFormBody } from "@/server/core/http/oauth";
import { exchangeToken } from "@/server/modules/oauth/oauth.service";

/** RFC 6749 token endpoint for a public client with PKCE: an authorization code or a refresh token in, tokens out. */
export const POST = (req: Request) => handleOAuth(async () => oauthJson(await exchangeToken(getDb(), await readFormBody(req))));
