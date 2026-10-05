import type { Role } from "./dto";

/**
 * Live updates (TRIP-11): a short string that changes whenever what a trip page shows may have changed elsewhere (another
 * tab, a person the trip is shared with, a connected chat). The trip's version moves with every change to the trip or its
 * events, and the role decides what the page offers. The page and the server both build it here, so they always agree.
 */
export const tripRevision = (trip: { version: number; role: Role }): string => `${trip.version}.${trip.role}`;
