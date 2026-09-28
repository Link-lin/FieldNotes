import type { TripStatus, DueState, Disambiguation } from "./time";

export type Role = "owner" | "viewer";
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
  role: Role;
  ownerName: string | null; // shown to viewers only ("shared by")
  atlasLocation: (LatLon & { source: "catalog" | "owner" }) | null;
};

export type BookingTaskDTO = {
  tripId: string;
  tripTitle: string;
  itemId: string;
  itemTitle: string;
  /** The item's version, for the booking-list actions (BOOK-4). */
  itemVersion: number;
  dueDate: string | null;
  state: DueState | "no_due_date";
  /** False for a flight still missing its FLIGHT-2 fields. */
  canMarkBooked: boolean;
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
  email: string;
  status: InvitationStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
};

/** Returned once when an invitation is created or given a new link; the URL is never stored or listed. */
export type InvitationLinkDTO = { invitationId: string; invitationUrl: string; expiresAt: string; invitation: InvitationDTO };
