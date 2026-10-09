import "server-only";
import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";
import { requireTripOwner, requireTripRead } from "@/server/auth/access";
import { conflict, fieldConflict, HttpError, invalid } from "@/server/core/http/errors";
import { coverVersion, tripSummary } from "@/server/modules/trips/trips.mapper";
import type { TripSummaryDTO } from "@/shared/dto";
import { coverImage, deleteCover, saveCover } from "./cover.repository";
import { cleanJpeg, type CleanJpeg } from "./jpeg";

/** What the server accepts (DASH-8). The browser makes smaller images than these; see `cover-image.ts`. */
export const COVER_RULES = { fullEdge: 2048, smallEdge: 640, minSide: 32, maxRatio: 3, sameShape: 0.02 } as const;

/** The upload's parts: the two images and the cover version the change started from ("" for none). */
export type CoverParts = { full: Uint8Array; small: Uint8Array; base: string };

const badForm = () => new HttpError(400, "bad_request", "The upload must hold the cover's two images and the cover it replaces.");

/** The parts of a cover upload's form; 400 when one is missing or of the wrong kind. */
export async function coverParts(form: FormData): Promise<CoverParts> {
  const full = form.get("full");
  const small = form.get("small");
  const base = form.get("base");
  if (!(full instanceof Blob) || !(small instanceof Blob) || typeof base !== "string") throw badForm();
  return { full: new Uint8Array(await full.arrayBuffer()), small: new Uint8Array(await small.arrayBuffer()), base };
}

const ratio = (img: { width: number; height: number }) => Math.max(img.width, img.height) / Math.min(img.width, img.height);

/** One part as stored, without metadata; 422 when it isn't a JPEG of a size and shape the app keeps. */
function checkedImage(path: "full" | "small", bytes: Uint8Array, maxEdge: number): CleanJpeg {
  const img = cleanJpeg(bytes);
  if (!img) throw invalid([{ path, code: "invalid_image", message: "This isn't a JPEG image the app can store." }]);
  if (Math.max(img.width, img.height) > maxEdge || Math.min(img.width, img.height) < COVER_RULES.minSide) {
    throw invalid([{ path, code: "image_size", message: `The image must be ${COVER_RULES.minSide} to ${maxEdge} pixels on each side.` }]);
  }
  if (ratio(img) > COVER_RULES.maxRatio) throw invalid([{ path, code: "image_shape", message: "The image can be at most three times as long as it is wide." }]);
  return img;
}

/**
 * DASH-8: adds or replaces a trip's cover, for owners. Both images are checked and stored without metadata; the cover
 * must still be the one the change started from (`base`), so a change made elsewhere meanwhile is never overwritten.
 * The trip's version moves once.
 */
export async function setTripCover(db: Kysely<DB>, actor: Actor, tripId: string, parts: CoverParts, now = new Date()): Promise<TripSummaryDTO> {
  const full = checkedImage("full", parts.full, COVER_RULES.fullEdge);
  const small = checkedImage("small", parts.small, COVER_RULES.smallEdge);
  if (small.width > full.width || small.height > full.height || Math.abs(small.width / small.height / (full.width / full.height) - 1) > COVER_RULES.sameShape) {
    throw invalid([{ path: "small", code: "image_shape", message: "The small image must be a smaller copy of the full one." }]);
  }
  const hash = createHash("sha256").update(full.bytes).digest("hex");
  return db.transaction().execute(async (tx) => {
    const access = await requireTripOwner(tx, actor, tripId, true);
    if (coverVersion(access.trip.cover_hash) !== parts.base) throw fieldConflict(["cover"]);
    const row = await saveCover(tx, access.trip.id, access.trip.version, { hash, width: full.width, height: full.height, full: full.bytes, small: small.bytes });
    if (!row) throw conflict();
    return tripSummary({ ...row, owner_name: access.trip.owner_name }, access, now);
  });
}

/** DASH-8: removes a trip's cover, for owners, if it is still the one the change started from (`base`). */
export async function removeTripCover(db: Kysely<DB>, actor: Actor, tripId: string, base: string, now = new Date()): Promise<TripSummaryDTO> {
  return db.transaction().execute(async (tx) => {
    const access = await requireTripOwner(tx, actor, tripId, true);
    if (coverVersion(access.trip.cover_hash) !== base) throw fieldConflict(["cover"]);
    if (!access.trip.cover_hash) return tripSummary(access.trip, access, now);
    const row = await deleteCover(tx, access.trip.id, access.trip.version);
    if (!row) throw conflict();
    return tripSummary({ ...row, owner_name: access.trip.owner_name }, access, now);
  });
}

/** DASH-8: one of the cover's images, for anyone who can read the trip; 404 like the trip, or when it has no cover. */
export async function readTripCover(db: Kysely<DB>, actor: Actor, tripId: string, size: "full" | "small"): Promise<Buffer> {
  const { trip } = await requireTripRead(db, actor, tripId);
  const bytes = trip.cover_hash ? await coverImage(db, trip.id, size) : null;
  if (!bytes) throw new HttpError(404, "not_found", "This trip has no cover.");
  return bytes;
}
