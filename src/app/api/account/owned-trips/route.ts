import { route } from "@/server/core/http/route";
import { listOwnedTrips } from "@/server/modules/account/account.service";

/** ACCESS-10: the trips the person owns and who is on them, for choosing what happens to each when they delete their account. */
export const GET = route({}, async ({ db, actor }) => listOwnedTrips(db, actor));
