/**
 * `npm run db:seed:hawaii [-- you@example.com]`: loads the test trips (scripts/demo-trips.ts)
 * for your account, replacing any earlier copy. The account is the given email or the first
 * address in TRIP_OWNER_EMAILS, and must have signed in once. Development only.
 */
import { createDb } from "@/server/core/db/client";
import { normalizeEmail } from "@/server/core/env";
import { HAWAII_TITLE, seedDemoTrips, TEST_FRIEND } from "./demo-trips";
import { describeDbError } from "./db-error";
import { loadEnvFile } from "./env-file";

loadEnvFile();
if (process.env.NODE_ENV === "production") {
  console.error("The test trips are for local development only.");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
const email = normalizeEmail(process.argv[2] ?? process.env.TRIP_OWNER_EMAILS?.split(",")[0] ?? "");
if (!url || !email) {
  console.error("Set DATABASE_URL and TRIP_OWNER_EMAILS in .env.local (or pass your email: npm run db:seed:hawaii -- you@example.com).");
  process.exit(1);
}

const db = createDb(url);
try {
  const you = await db.selectFrom("User").select(["id", "email"]).where("email", "=", email).executeTakeFirst();
  if (!you) {
    console.error(`No account for ${email} yet. Sign in to the app once with that Google account, then run this again.`);
    process.exitCode = 1;
  } else {
    const { trips } = await seedDemoTrips(db, you);
    console.log(`Test trips loaded for ${email}:`);
    for (const t of trips) console.log(`  ${t.title}: ${t.items} events, ${t.viewers} sharing entries`);
    console.log(`\nOpen "${HAWAII_TITLE}" on the dashboard. The Kyoto trip is owned by ${TEST_FRIEND.name} and shared with you read-only.`);
    console.log("Run this again any time to reset them; your other trips are not touched.");
  }
} catch (err) {
  console.error("Seeding failed:", describeDbError(err));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
