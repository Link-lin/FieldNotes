import "server-only";
import type { FieldError } from "@/shared/dto";

/** An error with the HTTP status and stable code the API returns for it. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", "That trip or event doesn't exist, or you can't see it.");
export const forbidden = () => new HttpError(403, "forbidden", "Only the trip owner can do that.");
export const conflict = (message = "This changed in another tab or window. Reload to see the latest, then make your change again.") =>
  new HttpError(409, "version_conflict", message);
export const invalid = (fields: FieldError[], message = "Correct the highlighted fields.") => new HttpError(422, "validation_error", message, fields);
/** A field-level save (TRIP-10, DASH-6) whose fields were changed elsewhere since the edit began; each is named. */
export const fieldConflict = (paths: string[]) =>
  new HttpError(
    409,
    "field_conflict",
    "This was changed elsewhere (in another tab or window, by someone you share the trip with, or by a connected chat), so your change wasn't saved.",
    paths.map((path) => ({ path, code: "changed_elsewhere", message: "Changed elsewhere since you started editing." })),
  );
