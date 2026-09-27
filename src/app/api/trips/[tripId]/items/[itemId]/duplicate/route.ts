import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { duplicateItem } from "@/server/items";
import { versionSchema } from "@/shared/schemas";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await readJson(req, versionSchema);
    const { tripId, itemId } = await params;
    return json(await duplicateItem(getDb(), actor, tripId, itemId, body.expectedVersion), 201);
  });
}
