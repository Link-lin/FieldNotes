import { route } from "@/server/core/http/route";
import { HttpError } from "@/server/core/http/errors";
import { previewImport } from "@/server/modules/import/import.rules";
import { countUsage } from "@/server/modules/usage/usage.service";
import { previewRequestSchema } from "@/shared/import";

/** IMPORT-4–6: validate pasted JSON in memory; no trip data is written. */
export const POST = route({ ownerAccount: true, body: previewRequestSchema }, async ({ db, body }) => {
  const result = previewImport(body.responseText, body.ownerProvidedBudget);
  if (!result.ok) {
    await countUsage(db, [{ name: "import_preview_rejected" }]);
    throw new HttpError(422, result.code, "Correct the AI response and try again.", result.errors);
  }
  const p = result.preview;
  const needsFixes = p.trip.errors.length > 0 || p.items.some((i) => i.errors.length > 0 || i.sourceErrors.length > 0);
  // Only a daily count is written; the pasted response and preview are not stored (PRD section 8).
  await countUsage(db, [{ name: needsFixes ? "import_preview_needs_fixes" : "import_preview_ok" }]);
  return p;
});
