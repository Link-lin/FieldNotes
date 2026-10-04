import { route } from "@/server/core/http/route";
import { revokeInvitation, updateInvitationRole } from "@/server/modules/invitations/invitations.service";
import { invitationRoleSchema } from "@/shared/schemas";

type P = { tripId: string; invitationId: string };

/** ACCESS-5: change what a pending or accepted person may do. */
export const PATCH = route<P, typeof invitationRoleSchema>({ body: invitationRoleSchema }, ({ db, actor, params, body }) =>
  updateInvitationRole(db, actor, params.tripId, params.invitationId, body.role),
);

/** ACCESS-6: revoke an invitation or a person's access. */
export const DELETE = route<P>({}, ({ db, actor, params }) => revokeInvitation(db, actor, params.tripId, params.invitationId));
