/**
 * Regenerates the bundled place catalog and airport list (atlas-v1.md, MAP-2).
 * Sources (public domain):
 *  - Natural Earth v5.1.2 populated places (10m, full attributes incl. TIMEZONE) via the natural-earth-vector repository
 *  - Natural Earth admin-0 countries (50m) via the world-atlas npm package
 *  - OurAirports airports.csv
 * Run: npm run data:build   (needs network access to raw.githubusercontent.com)
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { geoBounds, geoCentroid, geoContains, geoDistance } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

const NE_TAG = "v5.1.2";
const PLACES_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_TAG}/geojson/ne_10m_populated_places.geojson`;
const AIRPORTS_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";

/** `tz`: IANA zones, most likely first. A city has one; a country lists the zones its places use. */
/** `rank`: Natural Earth scale rank (0 = most prominent); countries use 1, after the most prominent cities. */
type Place = { id: string; name: string; country: string; lat: number; lon: number; kind: "city" | "country"; tz: string[]; rank: number };

const validZone = (z: unknown): z is string => {
  if (typeof z !== "string" || !z.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const round = (n: number) => Math.round(n * 1e5) / 1e5;

async function get(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const places: Place[] = [];
const countriesTopo = JSON.parse(readFileSync("node_modules/world-atlas/countries-50m.json", "utf8")) as Topology;
const countries = feature(countriesTopo, countriesTopo.objects.countries as GeometryCollection<{ name: string }>);
for (const f of countries.features) {
  const name = f.properties?.name;
  if (!name) continue;
  const [lon, lat] = geoCentroid(f);
  places.push({ id: `country:${f.id ?? name}`, name, country: name, lat: round(lat), lon: round(lon), kind: "country", tz: [], rank: 1 });
}

const geo = JSON.parse(await get(PLACES_URL)) as { features: Array<{ properties: Record<string, unknown> }> };
for (const f of geo.features) {
  const p = f.properties;
  const name = String(p.NAME ?? p.NAMEASCII ?? "").trim();
  const country = String(p.ADM0NAME ?? "").trim();
  const lat = Number(p.LATITUDE);
  const lon = Number(p.LONGITUDE);
  if (!name || !country || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const tz = validZone(p.TIMEZONE) ? [p.TIMEZONE] : [];
  places.push({ id: `ne:${p.NE_ID ?? `${name}|${country}`}`, name, country, lat: round(lat), lon: round(lon), kind: "city", tz, rank: Number.isFinite(Number(p.SCALERANK)) ? Number(p.SCALERANK) : 10 });
}

// Natural Earth has some wrong zones (Cardiff in Australia/Sydney, Santo Domingo in America/Bogota).
// 1) Drop a zone whose January offset is more than 3.5 h from the place's solar time.
const offsetHours = (zone: string) => {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(new Date("2026-01-15T12:00:00Z")).find((x) => x.type === "timeZoneName")?.value ?? "";
  const m = s.match(/GMT([+-])(\d\d):?(\d\d)?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60) : 0;
};
for (const place of places) {
  if (place.kind !== "city" || !place.tz.length) continue;
  const d = Math.abs(offsetHours(place.tz[0]!) - place.lon / 15) % 24;
  if (Math.min(d, 24 - d) > 3.5) place.tz = [];
}
// 2) Replace a zone that disagrees with every neighbor when 3+ same-country neighbors within 150 km agree.
const km = (a: Place, b: Place) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
const cities = places.filter((p) => p.kind === "city");
const fixes: Array<[Place, string]> = [];
for (const place of cities) {
  if (!place.tz.length) continue;
  const near = cities.filter((c) => c !== place && c.country === place.country && c.tz.length && km(place, c) < 150);
  const zones = new Set(near.map((c) => c.tz[0]));
  if (near.length >= 3 && zones.size === 1 && !zones.has(place.tz[0])) fixes.push([place, near[0]!.tz[0]!]);
}
for (const [place, zone] of fixes) place.tz = [zone];

// 3) Places with no zone borrow the nearest zoned place in the same country (within 400 km).
const zoned = places.filter((p) => p.kind === "city" && p.tz.length);
for (const place of places) {
  if (place.kind !== "city" || place.tz.length) continue;
  let best: Place | null = null;
  let bestKm = 400;
  for (const z of zoned) {
    if (z.country !== place.country) continue;
    const d = km(place, z);
    if (d < bestKm) { bestKm = d; best = z; }
  }
  if (best) place.tz = [...best.tz];
}

// A country's zones: those used by places inside its outline, most common first (at most 8),
// with the capital's zone leading.
const capitals = new Set(geo.features.filter((f) => String(f.properties.FEATURECLA ?? "").startsWith("Admin-0 capital")).map((f) => `ne:${f.properties.NE_ID}`));
for (const f of countries.features) {
  const place = places.find((p) => p.id === `country:${f.id ?? f.properties?.name}`);
  if (!place) continue;
  const [[x0, y0], [x1, y1]] = geoBounds(f);
  const counts = new Map<string, number>();
  let cap: string | undefined;
  let total = 0;
  for (const c of zoned) {
    // Same country name, or inside the outline (names differ between the two datasets).
    const inBox = c.lat >= y0 && c.lat <= y1 && (x0 <= x1 ? c.lon >= x0 && c.lon <= x1 : c.lon >= x0 || c.lon <= x1);
    if (c.country !== place.name && !(inBox && geoContains(f, [c.lon, c.lat]))) continue;
    total++;
    counts.set(c.tz[0]!, (counts.get(c.tz[0]!) ?? 0) + 1);
    if (capitals.has(c.id)) cap = c.tz[0];
  }
  // A zone seen only once in a well-covered country is usually a data slip; leave it out.
  const ranked = [...counts.entries()].filter(([, n]) => n > 1 || total < 5).sort((a, b) => b[1] - a[1]).map(([z]) => z);
  place.tz = [...new Set([...(cap ? [cap] : []), ...ranked])].slice(0, 8);
}

const airports: Record<string, [number, number]> = {};
const csv = (await get(AIRPORTS_URL)).split(/\r?\n/);
const head = parseCsvLine(csv[0]!);
const col = (n: string) => head.indexOf(n);
for (const line of csv.slice(1)) {
  if (!line) continue;
  const r = parseCsvLine(line);
  const type = r[col("type")];
  const code = r[col("iata_code")] ?? "";
  if (!/^[A-Z]{3}$/.test(code) || (type !== "large_airport" && type !== "medium_airport")) continue;
  if (airports[code] && type !== "large_airport") continue;
  airports[code] = [round(Number(r[col("latitude_deg")])), round(Number(r[col("longitude_deg")]))];
}

mkdirSync("src/data", { recursive: true });
places.sort((a, b) => a.name.localeCompare(b.name) || a.country.localeCompare(b.country));
writeFileSync("src/data/places.json", JSON.stringify(places));
writeFileSync("src/data/airports.json", JSON.stringify(airports));
writeFileSync(
  "src/data/SOURCES.md",
  `# Bundled geographic data\n\nGenerated by \`npm run data:build\` on ${new Date().toISOString().slice(0, 10)}.\n\n` +
    `- \`places.json\`: ${places.filter((p) => p.kind === "city").length} populated places from [Natural Earth](https://www.naturalearthdata.com/) ${NE_TAG} ` +
    `(ne_10m_populated_places, with each place's IANA time zone) and ${places.filter((p) => p.kind === "country").length} country centroids from Natural Earth 50m admin-0 via the \`world-atlas\` package. Public domain.\n` +
    `- \`airports.json\`: ${Object.keys(airports).length} IATA codes (large and medium airports) from [OurAirports](https://ourairports.com/data/) \`airports.csv\`. Public domain.\n` +
    `- The globe outline uses \`world-atlas\` land-110m (Natural Earth, public domain) directly from node_modules.\n\n` +
    `The app never calls a geocoder or map service; these files are the only place data.\n`,
);
console.log(`places: ${places.length}, airports: ${Object.keys(airports).length}`);
