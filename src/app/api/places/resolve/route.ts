import { route } from "@/server/core/http/route";
import { findPlaceCandidates } from "@/server/modules/places/geocode.service";
import { importLocationRequestSchema } from "@/shared/import";

/** Resolve a single place for an owner-reviewed import preview or event edit. */
export const POST = route({ ownerAccount: true, body: importLocationRequestSchema }, async ({ body }) =>
  findPlaceCandidates(body.location, body.destination));
