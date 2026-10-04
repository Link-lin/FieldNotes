import { sql, type Kysely } from "kysely";
import { createDb } from "@/server/core/db/client";
import type { DB } from "@/server/core/db/schema";
import { actorFor, type Actor } from "@/server/auth/actor";
import type { ItemInput } from "@/shared/schemas";

let db: Kysely<DB> | null = null;
export function testDb(): Kysely<DB> {
  if (!db) db = createDb(process.env.DATABASE_URL!);
  return db;
}

export async function reset(): Promise<void> {
  await sql`truncate plan_items, import_receipts, trip_viewers, trips, usage_counts, oauth_clients, "Session", "Account", "User" cascade`.execute(testDb());
}

export async function makeActor(email: string, name = email.split("@")[0]!): Promise<Actor> {
  const u = await testDb().insertInto("User").values({ email, name, emailVerified: null, image: null }).returning(["id", "email"]).executeTakeFirstOrThrow();
  return actorFor(u);
}

/** An account that signed in with WeChat only: it has a name (the WeChat nickname) but no email address. */
export async function makeActorWithoutEmail(name: string | null = "Mei"): Promise<Actor> {
  const u = await testDb().insertInto("User").values({ email: null, name, emailVerified: null, image: null }).returning(["id", "email"]).executeTakeFirstOrThrow();
  return actorFor(u);
}

export async function grant(tripId: string, viewer: Actor, status: "accepted" | "pending" | "revoked" = "accepted", role: "viewer" | "editor" | "owner" = "viewer", acceptedAt = new Date()) {
  await testDb()
    .insertInto("trip_viewers")
    .values({
      trip_id: tripId,
      invitee_email_normalized: viewer.email!,
      viewer_user_id: status === "accepted" ? viewer.userId : null,
      role,
      status,
      invitation_token_hash: status === "revoked" ? null : Buffer.from(crypto.randomUUID()),
      expires_at: new Date(Date.now() + 7 * 864e5),
      accepted_at: status === "accepted" ? acceptedAt : null,
    })
    .execute();
}

export const NOW = new Date("2026-09-26T12:00:00Z");

export function event(over: Partial<Record<string, unknown>> = {}): ItemInput {
  return {
    type: "activity",
    title: "Fushimi Inari at sunrise",
    location: "Fushimi Inari Taisha, Kyoto",
    notes: null,
    links: [],
    mapUrl: null,
    bookingStatus: "not_required",
    bookingDueDate: null,
    plannedPrice: null,
    localDate: "2026-11-17",
    localTime: "07:00",
    timeZone: null,
    timeDisambiguation: null,
    durationMinutes: null,
    ...over,
  } as ItemInput;
}

export function flight(over: Partial<Record<string, unknown>> = {}): ItemInput {
  const ep = { airportCode: null, localDateTime: null, timeZone: null, timeDisambiguation: null };
  return {
    type: "flight",
    title: "San Francisco to Tokyo Haneda",
    location: null,
    notes: null,
    links: [],
    mapUrl: null,
    bookingStatus: "needs_booking",
    bookingDueDate: null,
    plannedPrice: null,
    plannedDepartureDate: null,
    airline: null,
    flightNumber: null,
    departure: ep,
    arrival: ep,
    ...over,
  } as ItemInput;
}

export const tripInput = {
  title: "Kyoto & Tokyo",
  destination: "Tokyo, Japan",
  startDate: "2026-11-15",
  endDate: "2026-11-24",
  timeZone: "Asia/Tokyo",
  budget: { amount: "3500", currency: "USD" },
};
