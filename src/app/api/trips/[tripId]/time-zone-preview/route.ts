import { z } from "zod";
import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, json } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { previewTimeZone } from "@/server/trips";
import { canonicalTimeZone, isTimeZone } from "@/shared/time";

const schema = z.object({ timeZone: z.string().refine(isTimeZone, { message: "Choose a valid time zone." }).transform(canonicalTimeZone), expectedVersion: z.number().int().min(1) }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    const body = await readJson(req, schema);
    return json(await previewTimeZone(getDb(), actor, (await params).tripId, body.timeZone, body.expectedVersion));
  });
}
