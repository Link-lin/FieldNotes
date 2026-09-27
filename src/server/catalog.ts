import "server-only";
import placesData from "@/data/places.json";
import type { PlaceDTO } from "@/shared/dto";

type Place = { id: string; name: string; country: string; lat: number; lon: number; kind: "city" | "country"; tz: string[]; rank: number };
const places = placesData as unknown as Place[];

/** Atlas matching normalization: Unicode NFKC, trim, case folding, collapsed whitespace. */
export function normalizePlace(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "united states of america",
  usa: "united states of america",
  "u.s.a.": "united states of america",
  us: "united states of america",
  "u.s.": "united states of america",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  "great britain": "united kingdom",
  uae: "united arab emirates",
  "czech republic": "czechia",
};
const canonicalCountry = (c: string) => COUNTRY_ALIASES[c] ?? c;

const byCityCountry = new Map<string, Place[]>();
const byCity = new Map<string, Place[]>();
const byCountry = new Map<string, Place>();
for (const p of places) {
  const country = canonicalCountry(normalizePlace(p.country));
  if (p.kind === "country") {
    byCountry.set(country, p);
    continue;
  }
  const city = normalizePlace(p.name);
  const key = `${city}|${country}`;
  byCityCountry.set(key, [...(byCityCountry.get(key) ?? []), p]);
  byCity.set(city, [...(byCity.get(city) ?? []), p]);
}

/**
 * Exact, unambiguous destination match (ATLAS-3): "City, Country", an exact country
 * name, or a city name that is unique in the catalog. Anything else stays unlocated.
 */
export function matchDestination(destination: string): { latitude: number; longitude: number } | null {
  const d = normalizePlace(destination);
  if (!d) return null;
  const comma = d.lastIndexOf(",");
  if (comma > 0) {
    const city = d.slice(0, comma).trim();
    const country = canonicalCountry(d.slice(comma + 1).trim());
    const hits = byCityCountry.get(`${city}|${country}`) ?? [];
    return hits.length === 1 ? { latitude: hits[0]!.lat, longitude: hits[0]!.lon } : null;
  }
  const country = byCountry.get(canonicalCountry(d));
  if (country) return { latitude: country.lat, longitude: country.lon };
  const cities = byCity.get(d) ?? [];
  return cities.length === 1 ? { latitude: cities[0]!.lat, longitude: cities[0]!.lon } : null;
}

const labelled = places.map((p) => ({
  p,
  label: p.kind === "country" ? p.name : `${p.name}, ${p.country}`,
  norm: normalizePlace(p.kind === "country" ? p.name : `${p.name}, ${p.country}`),
}));

/**
 * Search over the bundled catalog only (at most `limit` results): names that start with the
 * query first, then words that start with it, then any match; more prominent places first.
 */
export function searchPlaces(query: string, limit = 10): PlaceDTO[] {
  const q = normalizePlace(query);
  if (q.length < 2) return [];
  const tiers: Array<typeof labelled> = [[], [], []];
  for (const l of labelled) {
    if (l.norm.startsWith(q)) tiers[0]!.push(l);
    else if (l.norm.includes(` ${q}`) || l.norm.includes(`,${q}`)) tiers[1]!.push(l);
    else if (l.norm.includes(q)) tiers[2]!.push(l);
  }
  return tiers
    .flatMap((t) => t.sort((a, b) => a.p.rank - b.p.rank || a.label.length - b.label.length))
    .slice(0, limit)
    .map((l) => ({ id: l.p.id, label: l.label, latitude: l.p.lat, longitude: l.p.lon, kind: l.p.kind, timeZones: l.p.tz }));
}
