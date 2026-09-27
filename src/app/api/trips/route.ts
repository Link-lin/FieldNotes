import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { createTrip, getDashboard } from "@/server/trips";
import { tripInputSchema } from "@/shared/schemas";

export async function GET() {
  return handle(async () => json(await getDashboard(getDb(), await requireActor())));
}

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const input = await readJson(req, tripInputSchema);
    return json(await createTrip(getDb(), actor, input), 201);
  });
}
