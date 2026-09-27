import { getDb } from "@/server/core/db/client";
import { assertSameOrigin } from "@/server/core/http/request";
import { handle, json } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { restoreItem } from "@/server/items";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const { tripId, itemId } = await params;
    return json(await restoreItem(getDb(), actor, tripId, itemId));
  });
}
