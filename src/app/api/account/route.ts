import { z } from "zod";
import { getDb } from "@/server/core/db/client";
import { assertSameOrigin, readJson } from "@/server/core/http/request";
import { handle, noContent } from "@/server/core/http/respond";
import { requireActor } from "@/server/auth/session";
import { deleteAccount } from "@/server/trips";

const schema = z.object({ confirm: z.literal("DELETE") }).strict();

/** ACCESS-10: deletes the account and every trip it owns; the session goes with it. */
export async function DELETE(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const actor = await requireActor();
    await readJson(req, schema);
    await deleteAccount(getDb(), actor);
    const res = noContent();
    for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
      res.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name.startsWith("__Secure") ? "; Secure" : ""}`);
    }
    return res;
  });
}
