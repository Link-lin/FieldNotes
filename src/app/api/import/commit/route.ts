import { route } from "@/server/core/http/route";
import { HttpError } from "@/server/core/http/errors";
import { isUuid } from "@/server/core/http/request";
import { json } from "@/server/core/http/respond";
import { commitImport } from "@/server/modules/import/import.service";
import { importCommitSchema } from "@/shared/import";

/** IMPORT-8: confirm one normalized preview; retry safely with the same key. */
export const POST = route({ ownerAccount: true, body: importCommitSchema }, async ({ actor, db, body, req }) => {
  const key = req.headers.get("Idempotency-Key");
  if (!key || !isUuid(key)) throw new HttpError(400, "bad_idempotency_key", "Start a new import and try again.");
  const result = await commitImport(db, actor, body, key);
  return json({ tripId: result.tripId }, result.reused ? 200 : 201);
});
