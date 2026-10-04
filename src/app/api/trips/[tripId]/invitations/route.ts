import { route } from "@/server/core/http/route";
import { createInvitation, createLinkInvitation, listInvitations } from "@/server/modules/invitations/invitations.service";
import { invitationCreateSchema } from "@/shared/schemas";

type P = { tripId: string };

/** ACCESS-11: the people a trip is shared with and their invitations (owners only). Links and token hashes are never listed. */
export const GET = route<P>({}, ({ db, actor, params }) => listInvitations(db, actor, params.tripId));

/**
 * ACCESS-3/6: invite one email, or one person by link (a label instead of an address), or give an existing email
 * invitation a new link. The link is returned once.
 */
export const POST = route<P, typeof invitationCreateSchema>({ body: invitationCreateSchema, status: 201 }, ({ db, actor, params, body }) =>
  body.email !== undefined
    ? createInvitation(db, actor, params.tripId, body.email, undefined, body.role)
    : createLinkInvitation(db, actor, params.tripId, body.label!, undefined, body.role),
);
