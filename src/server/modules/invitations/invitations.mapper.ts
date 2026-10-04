import "server-only";
import type { InvitationDTO } from "@/shared/dto";
import type { InvitationRow } from "./invitations.repository";
import { invitationStatus } from "./invitations.rules";

/** No token hash, viewer user ID or trip ID leaves the server. `joined_name` is the accepting account's name, when listed. */
export function invitationDto(row: InvitationRow & { joined_name?: string | null }, now: Date): InvitationDTO {
  const status = invitationStatus(row, now);
  return {
    id: row.id,
    email: row.invitee_email_normalized,
    label: row.label,
    joinedAs: status === "accepted" && row.label !== null ? (row.joined_name ?? null) : null,
    role: row.role,
    status,
    expiresAt: status === "pending" || status === "expired" ? (row.expires_at?.toISOString() ?? null) : null,
    acceptedAt: status === "accepted" ? (row.accepted_at?.toISOString() ?? null) : null,
    revokedAt: status === "revoked" ? (row.revoked_at?.toISOString() ?? null) : null,
  };
}
