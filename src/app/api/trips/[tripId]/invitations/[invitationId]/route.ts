import { route } from "@/server/core/http/route";
import { revokeInvitation } from "@/server/modules/invitations/invitations.service";

/** ACCESS-6: revoke an invitation or a viewer's access. */
export const DELETE = route<{ tripId: string; invitationId: string }>({}, ({ db, actor, params }) =>
  revokeInvitation(db, actor, params.tripId, params.invitationId),
);
