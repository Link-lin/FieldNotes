import { getDb } from "@/server/core/db/client";
import { databaseIsUp } from "@/server/core/health";

export const dynamic = "force-dynamic";

/**
 * Health check for a container or load balancer: no session, no input, no trip data. It answers
 * 200 {"status":"ok"} when the database responds and 503 {"status":"unhealthy"} otherwise, and says
 * nothing else about the system.
 */
export async function GET(): Promise<Response> {
  const ok = await databaseIsUp(getDb());
  return Response.json({ status: ok ? "ok" : "unhealthy" }, { status: ok ? 200 : 503, headers: { "Cache-Control": "private, no-store" } });
}
