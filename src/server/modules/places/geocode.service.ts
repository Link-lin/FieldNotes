import "server-only";
import { HttpError } from "@/server/core/http/errors";
import type { ImportLocationResult } from "@/shared/import";

type GeoapifyResult = {
  lat?: unknown;
  lon?: unknown;
  formatted?: unknown;
  result_type?: unknown;
  rank?: { confidence?: unknown };
};

/** One bounded, owner-triggered lookup. No raw AI response or private item notes leave the app. */
export async function findPlaceCandidates(location: string, destination: string): Promise<ImportLocationResult> {
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) throw new HttpError(503, "place_lookup_unavailable", "Place lookup is not configured. Add a Geoapify API key, or import without map pins.");
  const region = destination.split(/[(&;]/)[0]?.trim() || destination;
  const query = location.toLocaleLowerCase().includes(region.toLocaleLowerCase()) ? location : `${location}, ${region}`;
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "3");
  url.searchParams.set("bias", "countrycode:none");
  url.searchParams.set("apiKey", key);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  } catch {
    throw new HttpError(502, "place_lookup_failed", "Place lookup did not respond. Try again or import without map pins.");
  }
  if (!response.ok) throw new HttpError(502, "place_lookup_failed", "Place lookup is unavailable. Try again or import without map pins.");
  let data: { results?: GeoapifyResult[] };
  try {
    data = await response.json() as { results?: GeoapifyResult[] };
  } catch {
    throw new HttpError(502, "place_lookup_failed", "Place lookup returned an invalid response. Try again or import without map pins.");
  }
  const candidates = (Array.isArray(data.results) ? data.results : []).flatMap((row) => {
    const lat = row.lat;
    const lon = row.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || typeof row.formatted !== "string") return [];
    return [{
      label: row.formatted.slice(0, 300),
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      confidence: typeof row.rank?.confidence === "number" ? Math.max(0, Math.min(1, row.rank.confidence)) : 0,
      kind: typeof row.result_type === "string" ? row.result_type : "unknown",
    }];
  });
  return { candidates };
}
