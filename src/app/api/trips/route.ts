import { getDb } from "@/server/db";
import { assertSameOrigin, handle, json, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
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
