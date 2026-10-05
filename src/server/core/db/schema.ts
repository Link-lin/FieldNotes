import type { ColumnType, Generated, Selectable } from "kysely";

/** NUMERIC columns are read as exact decimal strings (pg default parser). */
type Numeric = ColumnType<string, string, string>;
/** DATE and TIMESTAMP (without zone) are read as strings; see db.ts type parsers. */
type DateText = ColumnType<string, string, string>;
type Stamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UserTable {
  id: Generated<string>;
  name: string | null;
  /** Null for an account that signed in with WeChat only. */
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
}

export interface AccountTable {
  id: Generated<string>;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  token_type: string | null;
  scope: string | null;
  id_token: string | null;
  session_state: string | null;
}

export interface SessionTable {
  id: Generated<string>;
  userId: string;
  sessionToken: string;
  expires: Date;
}

export interface VerificationTokenTable {
  identifier: string;
  token: string;
  expires: Date;
}

export interface TripsTable {
  id: Generated<string>;
  /** The creator. Always set when a trip is inserted; null once their account is deleted and the trip stays with other owners. */
  owner_user_id: ColumnType<string | null, string, string | null>;
  title: string;
  destination: string;
  atlas_latitude: Numeric | null;
  atlas_longitude: Numeric | null;
  atlas_source: "catalog" | "owner" | null;
  start_date: DateText;
  end_date: DateText;
  time_zone: string;
  budget_amount: Numeric | null;
  budget_currency: string | null;
  version: Generated<number>;
  created_at: Stamp;
  updated_at: Stamp;
}

export interface TripViewersTable {
  id: Generated<string>;
  trip_id: string;
  /** The address an email invitation was made for; null for an invitation by link. */
  invitee_email_normalized: string | null;
  /** What the owner called someone invited by link; null for an email invitation. Exactly one of the two is set. */
  label: string | null;
  viewer_user_id: string | null;
  /** What the person may do once accepted; viewer unless the owner chose otherwise. */
  role: Generated<"viewer" | "editor" | "owner">;
  status: "pending" | "accepted" | "revoked";
  invitation_token_hash: Buffer | null;
  expires_at: Date | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Stamp;
  updated_at: Stamp;
}

export interface ImportReceiptsTable {
  id: Generated<string>;
  owner_user_id: string;
  idempotency_key: string;
  payload_hash: Buffer | null;
  trip_id: string | null;
  created_at: Stamp;
}

export interface UsageCountsTable {
  day: DateText;
  name: string;
  count: number; // bigint, parsed to a number by the client
}

/** An app that registered itself for the AI connector. Its id is its client_id; it is a public client. */
export interface OAuthClientsTable {
  id: Generated<string>;
  name: string;
  redirect_uris: string[];
  created_at: Stamp;
}

export type ConnectorScope = "trips:read" | "trips:read trips:write";

/** One person's approval of one app. Live while not revoked and not expired. */
export interface OAuthGrantsTable {
  id: Generated<string>;
  user_id: string;
  client_id: string;
  scope: ConnectorScope;
  /** The MCP address the approval is for; a token is accepted only there. */
  resource: string;
  created_at: Stamp;
  last_used_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface OAuthCodesTable {
  code_hash: Buffer;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: Date;
  used_at: Date | null;
}

export interface OAuthTokensTable {
  token_hash: Buffer;
  grant_id: string;
  kind: "access" | "refresh";
  scope: ConnectorScope;
  expires_at: Date;
  /** Refresh tokens only: when it was exchanged for a new pair. */
  used_at: Date | null;
}

export type ItemType = "flight" | "lodging" | "transport" | "meal" | "activity" | "other";
export type BookingStatus = "not_required" | "needs_booking" | "booked";
export type Choice = "earlier" | "later";

export interface PlanItemsTable {
  id: Generated<string>;
  trip_id: string;
  type: ItemType;
  title: string;
  location: string | null;
  notes: string | null;
  links: ColumnType<Array<{ label: string; url: string }>, string, string>;
  map_url: string | null;
  latitude: Numeric | null;
  longitude: Numeric | null;
  source: "ai" | "manual";
  /** When a person marked this AI draft reviewed (IMPORT-7); null while it is an unverified draft, and for manual items. */
  reviewed_at: Date | null;
  local_date: DateText | null;
  local_time: string | null;
  time_zone: string | null;
  time_disambiguation: Choice | null;
  duration_minutes: number | null;
  planned_departure_date: DateText | null;
  airline: string | null;
  flight_number: string | null;
  departure_airport_code: string | null;
  departure_local_datetime: DateText | null;
  departure_time_zone: string | null;
  departure_disambiguation: Choice | null;
  arrival_airport_code: string | null;
  arrival_local_datetime: DateText | null;
  arrival_time_zone: string | null;
  arrival_disambiguation: Choice | null;
  booking_status: BookingStatus;
  booking_due_date: DateText | null;
  planned_amount: Numeric | null;
  planned_currency: string | null;
  price_label: "estimate" | "quote" | null;
  price_source: "ai" | "owner" | null;
  deleted_at: Date | null;
  version: Generated<number>;
  created_at: Stamp;
  updated_at: Stamp;
}

export interface DB {
  User: UserTable;
  Account: AccountTable;
  Session: SessionTable;
  VerificationToken: VerificationTokenTable;
  trips: TripsTable;
  trip_viewers: TripViewersTable;
  import_receipts: ImportReceiptsTable;
  plan_items: PlanItemsTable;
  usage_counts: UsageCountsTable;
  oauth_clients: OAuthClientsTable;
  oauth_grants: OAuthGrantsTable;
  oauth_codes: OAuthCodesTable;
  oauth_tokens: OAuthTokensTable;
}

export type TripRow = Selectable<TripsTable>;
export type PlanItemRow = Selectable<PlanItemsTable>;
