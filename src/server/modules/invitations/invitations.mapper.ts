import "server-only";
import type { InvitationDTO } from "@/shared/dto";
import type { InvitationRow } from "./invitations.repository";
import { invitationStatus } from "./invitations.rules";

/** No token hash, viewer user ID or trip ID leaves the server. */
export function invitationDto(row: InvitationRow, now: Date): InvitationDTO {
  const status = invitationStatus(row, now);
  return {
    id: row.id,
    email: row.invitee_email_normalized,
    status,
    expiresAt: status === "pending" || status === "expired" ? (row.expires_at?.toISOString() ?? null) : null,
    acceptedAt: status === "accepted" ? (row.accepted_at?.toISOString() ?? null) : null,
    revokedAt: status === "revoked" ? (row.revoked_at?.toISOString() ?? null) : null,
  };
}
