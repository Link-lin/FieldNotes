import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { createItem } from "@/server/items";
import { itemInputSchema } from "@/shared/schemas";

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const input = await readJson(req, itemInputSchema);
    return json(await createItem(getDb(), actor, (await params).tripId, input), 201);
  });
}
