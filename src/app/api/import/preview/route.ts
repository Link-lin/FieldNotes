import { route } from "@/server/core/http/route";
import { HttpError } from "@/server/core/http/errors";
import { previewImport } from "@/server/modules/import/import.rules";
import { previewRequestSchema } from "@/shared/import";

/** IMPORT-4–6: validate pasted JSON in memory; no trip data is written. */
export const POST = route({ ownerAccount: true, body: previewRequestSchema }, ({ body }) => {
  const result = previewImport(body.responseText, body.ownerProvidedBudget);
  if (!result.ok) throw new HttpError(422, result.code, "Correct the AI response and try again.", result.errors);
  return Promise.resolve(result.preview);
});
