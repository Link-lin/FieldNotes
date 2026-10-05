import { route } from "@/server/core/http/route";
import { getDashboardRevision } from "@/server/modules/dashboard/dashboard.service";

/** TRIP-11: the open dashboard asks every few seconds whether any of its trips changed. */
export const GET = route({}, ({ db, actor }) => getDashboardRevision(db, actor));
