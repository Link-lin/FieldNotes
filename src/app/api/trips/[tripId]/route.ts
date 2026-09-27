import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json, noContent } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { deleteTrip, getTripDetail, updateTrip } from "@/server/trips";
import { tripDeleteSchema, tripPatchSchema } from "@/shared/schemas";

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => json(await getTripDetail(getDb(), await requireActor(), (await params).tripId)));
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const patch = await readJson(req, tripPatchSchema);
    return json(await updateTrip(getDb(), actor, (await params).tripId, patch));
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await readJson(req, tripDeleteSchema);
    await deleteTrip(getDb(), actor, (await params).tripId, body.expectedVersion);
    return noContent();
  });
}
