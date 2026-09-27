import { getDb } from "@/server/db";
import { assertSameOrigin, handle, json, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
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
