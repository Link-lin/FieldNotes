import { getDb } from "@/server/db";
import { assertSameOrigin, handle, json, noContent, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { deleteItem, updateItem } from "@/server/items";
import { itemPatchSchema, versionSchema } from "@/shared/schemas";

type Ctx = { params: Promise<{ tripId: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await readJson(req, itemPatchSchema);
    const { tripId, itemId } = await params;
    return json(await updateItem(getDb(), actor, tripId, itemId, body));
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await readJson(req, versionSchema);
    const { tripId, itemId } = await params;
    await deleteItem(getDb(), actor, tripId, itemId, body.expectedVersion);
    return noContent();
  });
}
