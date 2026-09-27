import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json, noContent } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
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
