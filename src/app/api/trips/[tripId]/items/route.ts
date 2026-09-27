import { getDb } from "@/server/db";
import { assertSameOrigin, handle, json, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
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
