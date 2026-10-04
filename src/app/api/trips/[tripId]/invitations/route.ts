import { route } from "@/server/core/http/route";
import { createInvitation, listInvitations } from "@/server/modules/invitations/invitations.service";
import { invitationCreateSchema } from "@/shared/schemas";

type P = { tripId: string };

/** ACCESS-11: the people a trip is shared with and their invitations (owners only). Links and token hashes are never listed. */
export const GET = route<P>({}, ({ db, actor, params }) => listInvitations(db, actor, params.tripId));

/** ACCESS-3/6: invite one email, or give an existing invitation a new link. The link is returned once. */
export const POST = route<P, typeof invitationCreateSchema>({ body: invitationCreateSchema, status: 201 }, ({ db, actor, params, body }) =>
  createInvitation(db, actor, params.tripId, body.email, undefined, body.role),
);
