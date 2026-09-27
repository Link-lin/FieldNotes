import { route } from "@/server/core/http/route";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { createTrip } from "@/server/modules/trips/trips.service";
import { tripInputSchema } from "@/shared/schemas";

/** The dashboard data: every trip you can see, booking tasks and recent currencies. */
export const GET = route({}, ({ db, actor }) => getDashboard(db, actor));

/** DASH-3: create a trip (allowlisted owners only). */
export const POST = route({ body: tripInputSchema, status: 201 }, ({ db, actor, body }) => createTrip(db, actor, body));
