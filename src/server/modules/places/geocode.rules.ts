import type { ImportLocationCandidate, ImportLocationResult } from "@/shared/import";
import { haversineKm } from "@/shared/map-links";

export type GeocodeRow = {
  lat?: unknown; lon?: unknown; formatted?: unknown; name?: unknown; address_line1?: unknown;
  result_type?: unknown; city?: unknown; suburb?: unknown; district?: unknown; county?: unknown;
  state?: unknown; state_code?: unknown; country?: unknown; country_code?: unknown; postcode?: unknown;
  rank?: { confidence?: unknown };
};

/** Keep Hawaiian okina and accents from making equivalent place names look different. */
function words(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[ʻʼ‘’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}
function normalized(value: string): string {
  const text = words(value).join(" ");
  return ({ usa: "us", "u s a": "us", "united states": "us", "united states of america": "us", uk: "gb", "united kingdom": "gb" } as Record<string, string>)[text] ?? text;
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const split = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
const isMultiple = (value: string) => /\s(?:and|&)\s|[();/]/i.test(value);

function searchParts(location: string, destination: string): string[] {
  const parts = split(location);
  if (parts.length > 1) return parts;
  // A multi-stop destination is not an address. Its final comma-delimited region
  // is useful context, but choosing its first city/island would misdirect stops.
  const context = isMultiple(destination) ? split(destination).slice(-1).filter((part) => !isMultiple(part)) : split(destination);
  return [...parts, ...context.filter((part) => !normalized(location).includes(normalized(part)))];
}

function nameFor(parts: string[]): string {
  let name = parts[0] ?? "";
  // "Twin Falls Maui, Haiku, Maui, Hawaii" repeats the county in the venue name.
  for (const part of parts.slice(1)) {
    const nameWords = words(name);
    const suffix = words(part);
    if (suffix.length && nameWords.length >= suffix.length + 2 && nameWords.slice(-suffix.length).join(" ") === suffix.join(" ")) {
      name = name.split(/\s+/).slice(0, -suffix.length).join(" ");
    }
  }
  return name;
}

/** At most three searches; a qualified location is always tried unchanged first. */
export function placeQueries(location: string, destination: string): string[] {
  const parts = searchParts(location.trim(), destination.trim());
  const name = nameFor(parts);
  const tail = parts.slice(1).slice(-2);
  // "Hawaii Island, Hawaii" can make the geocoder search for streets called
  // Hawaii. Simplify the query, while still checking the original island below.
  const compact = tail.filter((part, index) => !tail.slice(index + 1).some((later) => normalized(part.replace(/\bisland\b/gi, "")) === normalized(later)));
  return [...new Set([parts.join(", "), [name, ...parts.slice(1)].join(", "), [name, ...compact].join(", ")])].filter(Boolean).slice(0, 3);
}

function containsWords(haystack: string, needle: string): boolean {
  const hay = new Set(words(normalized(haystack)));
  return words(normalized(needle)).every((word) => hay.has(word));
}

function matchesRegion(row: GeocodeRow, region: string): boolean {
  // An explicit island qualifier must match local geography, not just the state
  // with the same name (Hawaii Island versus the whole state of Hawaii).
  const island = /\bisland\b/i.test(region);
  const keys = island
    ? ["city", "suburb", "district", "county"] as const
    : ["city", "suburb", "district", "county", "state", "state_code", "country", "country_code", "postcode"] as const;
  const qualifier = region.replace(/\b(island|county|prefecture|province)\b/gi, "").trim();
  // A qualifier can contain several fields, for example "HI 96815".
  return !!qualifier && containsWords(keys.map((key) => text(row[key])).join(" "), qualifier);
}

function regionsFor(parts: string[]): string[] {
  // The last two short qualifiers are the geographic context. Earlier segments
  // can be a hotel brand or a containing park; don't mistake those for cities.
  return parts.slice(1).slice(-2).filter((part) => words(part).length <= 4
    && !/^\d+\s+\S/.test(part) // A numbered street address is not a region.
    && !/\b(resort|hotel|park|trail|district)\b/i.test(part));
}

/** Reject unrelated fallback results before they ever become selectable pins. */
export function placeMatches(rows: GeocodeRow[], location: string, destination: string): ImportLocationResult {
  const parts = searchParts(location, destination);
  const regions = regionsFor(parts);
  const name = nameFor(parts);
  const nameWords = words(name).filter((word) => !["the", "a", "an", "of", "and"].includes(word));
  const distinctive = nameWords.filter((word) => !["national", "state", "park", "beach", "trail", "visitor", "center", "centre", "district", "falls", "black", "sand", "recreation", "area"].includes(word));
  const address = /^\d/.test(name);
  const ranked = rows.flatMap((row) => {
    const lat = row.lat, lon = row.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || typeof row.formatted !== "string") return [];
    if (regions.some((region) => !matchesRegion(row, region))) return [];
    const returnedName = address ? row.formatted : text(row.name) || text(row.address_line1);
    const returnedWords = new Set(words(returnedName));
    const coverage = nameWords.length ? nameWords.filter((word) => returnedWords.has(word)).length / nameWords.length : 0;
    if (coverage < 0.6 || (!address && distinctive.length > 0 && !distinctive.some((word) => returnedWords.has(word)))) return [];
    const exactName = normalized(returnedName) === normalized(name);
    const confidence = typeof row.rank?.confidence === "number" && Number.isFinite(row.rank.confidence) ? Math.max(0, Math.min(1, row.rank.confidence)) : 0;
    const kind = text(row.result_type) || "unknown";
    const precise = address ? kind === "building" : ["amenity", "building"].includes(kind);
    const candidate: ImportLocationCandidate = { label: row.formatted.slice(0, 300), latitude: Math.round(lat * 1e5) / 1e5, longitude: Math.round(lon * 1e5) / 1e5, confidence, kind };
    return [{ candidate, name: normalized(returnedName), coverage, exactName,
      automatic: precise && coverage === 1 && (address || distinctive.length > 0) && regions.length > 0 && confidence >= (address ? 0.95 : exactName ? 0.5 : 0.8),
      score: coverage * 2 + (exactName ? 1 : 0) + (precise ? 0.5 : 0) + confidence }];
  }).sort((a, b) => b.score - a.score);
  const unique = ranked.filter((match, index) => !ranked.slice(0, index).some((earlier) => earlier.name === match.name && haversineKm([earlier.candidate.latitude, earlier.candidate.longitude], [match.candidate.latitude, match.candidate.longitude]) < 0.1));
  const best = unique[0];
  // Multiple plausible venues far apart need a choice, even if one has a higher
  // address confidence. Nearby representations of the same venue can share a pin.
  const ambiguous = best && unique.slice(1).some((other) => other.automatic && (!best.exactName || other.exactName) && haversineKm([best.candidate.latitude, best.candidate.longitude], [other.candidate.latitude, other.candidate.longitude]) > 0.5);
  return { candidates: unique.slice(0, 3).map((match) => match.candidate), suggestedIndex: best?.automatic && !ambiguous ? 0 : null };
}
