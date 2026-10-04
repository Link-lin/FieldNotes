import { route } from "@/server/core/http/route";
import { renewInvitation } from "@/server/modules/invitations/invitations.service";

type P = { tripId: string; invitationId: string };

/** ACCESS-3: a new link for an entry made by link, which has no address to send it to. The link is returned once. */
export const POST = route<P>({ status: 201 }, ({ db, actor, params }) => renewInvitation(db, actor, params.tripId, params.invitationId));
