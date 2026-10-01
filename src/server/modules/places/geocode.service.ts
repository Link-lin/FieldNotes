import "server-only";
import { HttpError } from "@/server/core/http/errors";
import type { ImportLocationResult } from "@/shared/import";
import { placeMatches, placeQueries, type GeocodeRow } from "./geocode.rules";

/** A bounded, owner-triggered lookup. Only the place and destination leave the app. */
export async function findPlaceCandidates(location: string, destination: string): Promise<ImportLocationResult> {
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) throw new HttpError(503, "place_lookup_unavailable", "Place lookup is not configured. Add a Geoapify API key, or import without map pins.");
  const signal = AbortSignal.timeout(15000);
  for (const query of placeQueries(location, destination)) {
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("bias", "countrycode:none");
    url.searchParams.set("apiKey", key);
    let response: Response;
    try {
      response = await fetch(url, { signal, cache: "no-store" });
    } catch {
      throw new HttpError(502, "place_lookup_failed", "Place lookup did not respond. Try again or import without map pins.");
    }
    if (!response.ok) throw new HttpError(502, "place_lookup_failed", "Place lookup is unavailable. Try again or import without map pins.");
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new HttpError(502, "place_lookup_failed", "Place lookup returned an invalid response. Try again or import without map pins.");
    }
    const rows = data && typeof data === "object" && "results" in data && Array.isArray(data.results)
      ? data.results.filter((row): row is GeocodeRow => !!row && typeof row === "object") : [];
    const result = placeMatches(rows, location, destination);
    if (result.candidates.length) return result;
  }
  return { candidates: [], suggestedIndex: null };
}
