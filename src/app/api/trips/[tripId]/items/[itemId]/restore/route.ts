import { getDb } from "@/server/db";
import { assertSameOrigin, handle, json } from "@/server/http";
import { requireActor } from "@/server/session";
import { restoreItem } from "@/server/items";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const { tripId, itemId } = await params;
    return json(await restoreItem(getDb(), actor, tripId, itemId));
  });
}
