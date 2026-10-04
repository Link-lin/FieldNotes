import { requireConnector } from "@/server/core/http/oauth";
import { route } from "@/server/core/http/route";
import { disconnect } from "@/server/modules/oauth/oauth.service";

/** CONNECT-5: disconnect one of the person's own AI connections. It stops working on its next request. */
export const DELETE = route<{ connectionId: string }>({}, async ({ actor, db, params }) => {
  requireConnector();
  await disconnect(db, actor, params.connectionId);
});
