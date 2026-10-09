import "server-only";
import type { TripRow } from "@/server/core/db/schema";
import type { Role, TripCoverDTO, TripSummaryDTO } from "@/shared/dto";
import { dateInZone, daysBetween, tripStatus } from "@/shared/time";

/** DASH-8: a cover's version, the first 16 hex characters of its stored image's hash ("" for no cover). */
export const coverVersion = (hash: string | null): string => (hash ? hash.slice(0, 16) : "");

function coverDto(trip: TripRow): TripCoverDTO | null {
  if (!trip.cover_hash || !trip.cover_width || !trip.cover_height) return null;
  const version = coverVersion(trip.cover_hash);
  const at = (size: "full" | "small") => `/api/trips/${trip.id}/cover?size=${size}&v=${version}`;
  return { version, full: at("full"), small: at("small"), width: trip.cover_width, height: trip.cover_height };
}

/**
 * Trip row to the summary every screen uses. Day counts are computed in the trip's own time zone.
 * `access` is the viewer's role and whether they created the trip.
 */
export function tripSummary(trip: TripRow & { owner_name?: string | null }, access: { role: Role; primaryOwner: boolean }, now: Date): TripSummaryDTO {
  const today = dateInZone(trip.time_zone, now.getTime());
  const status = tripStatus(trip.start_date, trip.end_date, today);
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.start_date,
    endDate: trip.end_date,
    timeZone: trip.time_zone,
    status,
    daysToStart: status === "upcoming" ? daysBetween(today, trip.start_date) : null,
    dayIndex: status === "ongoing" ? daysBetween(trip.start_date, today) + 1 : null,
    daysSinceEnd: status === "past" ? daysBetween(trip.end_date, today) : null,
    dayCount: daysBetween(trip.start_date, trip.end_date) + 1,
    role: access.role,
    primaryOwner: access.primaryOwner,
    ownerName: access.primaryOwner ? null : (trip.owner_name ?? null),
    creatorGone: trip.owner_user_id === null,
    atlasLocation:
      trip.atlas_latitude !== null && trip.atlas_longitude !== null && trip.atlas_source
        ? { latitude: Number(trip.atlas_latitude), longitude: Number(trip.atlas_longitude), source: trip.atlas_source }
        : null,
    cover: coverDto(trip),
  };
}
