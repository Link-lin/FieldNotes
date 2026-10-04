import type { TripStatus, DueState, Disambiguation } from "./time";

export type Role = "owner" | "editor" | "viewer";
export type ItemType = "flight" | "lodging" | "transport" | "meal" | "activity" | "other";
export type BookingStatus = "not_required" | "needs_booking" | "booked";
export type MoneyDTO = { amount: string; currency: string };
export type LatLon = { latitude: number; longitude: number };

export type TripSummaryDTO = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string; // inclusive
  timeZone: string;
  status: TripStatus;
  daysToStart: number | null; // upcoming only, in the trip time zone
  dayIndex: number | null; // ongoing only, 1-based
  daysSinceEnd: number | null; // past only, in the trip time zone
  dayCount: number;
  role: Role; // what you may do on this trip
  primaryOwner: boolean; // you created it (a co-owner has the owner role without this)
  ownerName: string | null; // who created it, for everyone else ("shared by")
  creatorGone: boolean; // the creator deleted their account, so the trip belongs to its owners
  atlasLocation: (LatLon & { source: "catalog" | "owner" }) | null;
};

export type BookingTaskDTO = {
  tripId: string;
  tripTitle: string;
  itemId: string;
  itemTitle: string;
  dueDate: string | null;
  state: DueState | "no_due_date";
};

export type DashboardDTO = {
  canCreateTrips: boolean;
  /** Currencies the owner used most recently (budgets and prices), newest first; empty for viewers. */
  recentCurrencies: string[];
  trips: TripSummaryDTO[];
  ownerBookingTasks: BookingTaskDTO[];
};

export type FlightEndpointDTO = {
  airportCode: string | null;
  localDateTime: string | null; // YYYY-MM-DDTHH:mm, no offset
  timeZone: string | null;
  timeDisambiguation: Disambiguation | null;
};

export type PlanItemDTO = {
  id: string;
  version: number;
  type: ItemType;
  title: string;
  source: "ai" | "manual";
  location: string | null;
  notes: string | null;
  links: Array<{ label: string; url: string }>;
  mapUrl: string | null;
  mapProvider: string | null;
  coordinates: (LatLon & { source: "map_link" | "airport" }) | null;
  bookingStatus: BookingStatus;
  bookingDueDate: string | null;
  bookingDueState: DueState | null;
  plannedPrice: (MoneyDTO & { label: "estimate" | "quote"; source: "ai" | "owner" }) | null;
  localDate: string | null;
  localTime: string | null;
  timeZone: string | null;
  timeDisambiguation: Disambiguation | null;
  durationMinutes: number | null;
  timelineDate: string | null;
  sortInstant: string | null;
  flightDetails: {
    plannedDepartureDate: string | null;
    airline: string | null;
    flightNumber: string | null;
    departure: FlightEndpointDTO;
    arrival: FlightEndpointDTO;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type PlannedTotalDTO = {
  currency: string;
  total: string;
  unverifiedCount: number;
  priceCount: number;
  byType: Array<{ type: ItemType; amount: string }>;
};

export type BudgetComparisonDTO = {
  currency: string;
  budget: string;
  planned: string;
  remaining: string;
  over: boolean;
};

export type TripDetailDTO = {
  trip: TripSummaryDTO & { version: number; budget: MoneyDTO | null; today: string };
  items: PlanItemDTO[];
  plannedTotals: PlannedTotalDTO[];
  budgetComparison: BudgetComparisonDTO | null;
  /** As in DashboardDTO; empty for viewers. */
  recentCurrencies: string[];
};

export type FieldError = { path: string; code: string; message: string };
export type ApiError = { error: { code: string; message: string; fields?: FieldError[] } };

/** A bundled catalog place. `timeZones`: likely IANA zones, best first (a city has one; a country may list several). */
export type PlaceDTO = { id: string; label: string; latitude: number; longitude: number; kind: "city" | "country"; timeZones: string[] };

/** ACCESS-6/11. `expired` is derived from a pending invitation whose expiry has passed. */
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

/** One viewer or invitation in the owner's Share dialog. Never carries the link or its hash. */
export type InvitationDTO = {
  id: string;
  /** The address an email invitation was made for; null for an invitation by link. */
  email: string | null;
  /** What the owner called someone invited by link (only owners see it); null for an email invitation. */
  label: string | null;
  /** For an accepted invitation by link: the name the person signed in with, so the owner can check who joined. */
  joinedAs: string | null;
  /** What this person may do once they accept (or do now, if already accepted). */
  role: Role;
  status: InvitationStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
};

/** Whether the invitation email went out: sent, failed (the link still works, so copy it), or off (email isn't set up). */
export type InvitationDelivery = "sent" | "failed" | "off";

/** Returned once when an invitation is created or given a new link; the URL is never stored or listed. */
export type InvitationLinkDTO = { invitationId: string; invitationUrl: string; expiresAt: string; invitation: InvitationDTO; delivery: InvitationDelivery };

/**
 * ACCESS-10: a trip the person owns, for choosing what happens to it when they delete their account.
 * `otherOwners` names who keeps owning it if they leave (empty when nobody else does); `people` is everyone
 * else on it, with the `id` to send as `personId`, in the order ownership would pass to them.
 */
export type OwnedTripDTO = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  otherOwners: string[];
  people: Array<{ id: string; name: string; role: Role }>;
};
