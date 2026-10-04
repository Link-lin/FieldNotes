import { requireConnector } from "@/server/core/http/oauth";
import { route } from "@/server/core/http/route";
import { listConnections } from "@/server/modules/oauth/oauth.service";

/** CONNECT-5: the signed-in person's live AI connections. */
export const GET = route({}, async ({ actor, db }) => {
  requireConnector();
  return listConnections(db, actor);
});
