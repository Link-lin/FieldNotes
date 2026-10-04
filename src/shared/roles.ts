import type { Role } from "./dto";

/**
 * What each role may do on one trip. The server enforces this (server/auth/access.ts); the screens only
 * mirror it to show or hide controls.
 *   viewer  reads the trip.
 *   editor  also adds, changes and deletes events, bookings and notes.
 *   owner   also changes the trip itself, shares it, changes roles and deletes it.
 * The person who created a trip is its primary owner: always an owner, and never in the sharing list.
 */
export const canEdit = (role: Role): boolean => role === "owner" || role === "editor";
export const canManage = (role: Role): boolean => role === "owner";

export const ROLES: readonly Role[] = ["viewer", "editor", "owner"];
export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", editor: "Editor", owner: "Owner" };
/** Told to the person being invited, in the invitation message and email. */
export const ROLE_YOU_CAN: Record<Role, string> = {
  viewer: "You can view it but not change it.",
  editor: "You can view it and change its events, bookings and notes.",
  owner: "You can view it, change it, share it and delete it.",
};
export const ROLE_HELP: Record<Role, string> = {
  viewer: "Can see everything on the trip but can't change anything.",
  editor: "Can also add, change and delete events, bookings and notes.",
  owner: "Can also change the trip's details, share it, change roles and delete it.",
};
