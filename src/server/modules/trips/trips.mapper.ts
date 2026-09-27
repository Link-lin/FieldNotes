import "server-only";
import type { TripRow } from "@/server/core/db/schema";
import type { Role, TripSummaryDTO } from "@/shared/dto";
import { dateInZone, daysBetween, tripStatus } from "@/shared/time";

/** Trip row to the summary every screen uses. Day counts are computed in the trip's own time zone. */
export function tripSummary(trip: TripRow & { owner_name?: string | null }, role: Role, now: Date): TripSummaryDTO {
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
    role,
    ownerName: role === "viewer" ? (trip.owner_name ?? null) : null,
    atlasLocation:
      trip.atlas_latitude !== null && trip.atlas_longitude !== null && trip.atlas_source
        ? { latitude: Number(trip.atlas_latitude), longitude: Number(trip.atlas_longitude), source: trip.atlas_source }
        : null,
  };
}
