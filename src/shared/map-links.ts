/**
 * Map-link rules (PRD MAP-1, MAP-2). Pure functions with no I/O: links are never
 * fetched, resolved or previewed.
 */
export const MAX_URL_LENGTH = 2048;

const TRACKING_PARAM = /^(utm_.*|g_ep|g_st|entry|authuser|shorturl|ved|ei|sca_esv|fbclid|gclid)$/i;
const GOOGLE_HOST = /^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const GOOGLE_MAPS_HOST = /^maps\.google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

export type MapProvider = "Google Maps" | "Apple Maps" | "OpenStreetMap" | "Amap" | "Baidu Maps";

/** Parse an https URL without user information, or return null. */
export function parseHttpsUrl(value: string): URL | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Parse an http(s) URL without user information (ordinary item links). */
export function parseWebUrl(value: string): URL | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Exact-hostname provider match; null for any other host. */
export function knownProvider(url: URL): MapProvider | null {
  const host = url.hostname.toLowerCase();
  if (GOOGLE_HOST.test(host) && url.pathname.startsWith("/maps")) return "Google Maps";
  if (GOOGLE_MAPS_HOST.test(host) || host === "maps.app.goo.gl") return "Google Maps";
  if (host === "maps.apple.com") return "Apple Maps";
  if (host === "openstreetmap.org" || host === "www.openstreetmap.org") return "OpenStreetMap";
  if (host === "amap.com" || host.endsWith(".amap.com")) return "Amap";
  if (host === "map.baidu.com") return "Baidu Maps";
  return null;
}

/** Label for an "Open in …" button: provider name or the real (punycode) host. */
export function providerLabel(value: string): string | null {
  const url = parseWebUrl(value);
  if (!url) return null;
  return knownProvider(url) ?? url.hostname;
}

/** Remove known tracking parameters. Returns null when the link is not an acceptable https URL. */
export function cleanMapUrl(value: string): string | null {
  const url = parseHttpsUrl(value.trim());
  if (!url) return null;
  const drop: string[] = [];
  url.searchParams.forEach((_v, k) => {
    if (TRACKING_PARAM.test(k)) drop.push(k);
  });
  for (const k of drop) url.searchParams.delete(k);
  const out = url.toString();
  // Normalizing can lengthen a link (percent-encoding); the stored limit is 2048.
  return out.length <= 2048 ? out : null;
}

function coordinate(lat: string | undefined, lon: string | undefined): [number, number] | null {
  if (lat === undefined || lon === undefined) return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5];
}

/**
 * Read decimal coordinates from a Google Maps, Apple Maps or OpenStreetMap link.
 * Amap/Baidu (GCJ-02/BD-09) and shortened links never yield coordinates.
 */
export function coordinatesFromMapUrl(value: string): [number, number] | null {
  const url = parseHttpsUrl(value);
  if (!url) return null;
  const provider = knownProvider(url);
  if (provider !== "Google Maps" && provider !== "Apple Maps" && provider !== "OpenStreetMap") return null;
  if (url.hostname.toLowerCase() === "maps.app.goo.gl") return null;
  let text: string;
  try {
    text = decodeURIComponent(url.toString());
  } catch {
    text = url.toString();
  }
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const patterns = [
    new RegExp(`@${num},${num}`),
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&]mlat=${num}&mlon=${num}`),
    new RegExp(`#map=\\d+(?:\\.\\d+)?/${num}/${num}`),
    new RegExp(`[?&](?:ll|q|query|destination|sll)=${num},${num}`),
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const c = coordinate(m[1], m[2]);
      if (c) return c;
    }
  }
  return null;
}

/**
 * MAP-2: decimal coordinates typed or pasted on their own, as Google Maps copies them
 * ("35.01160, 135.76810") or separated by a space. Returns null for anything else.
 */
export function parseCoordinateText(value: string): [number, number] | null {
  const m = /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/.exec(value);
  return m ? coordinate(m[1], m[2]) : null;
}

/**
 * MAP-2: the map-link field also accepts coordinates. They are stored as a Google Maps search link
 * for that point, which opens in Google Maps and pins the stop. Anything else is returned unchanged.
 */
export function mapLinkFromInput(value: string): string {
  const c = parseCoordinateText(value);
  return c ? googleSearchUrl(`${c[0]},${c[1]}`) : value;
}

export function googleSearchUrl(query: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

/** What the event side panel's embedded Google map shows (MAP-8). */
export type EmbedTarget = { mode: "place"; q: string } | { mode: "directions"; origin: string; destination: string };

type EmbedItem = {
  location: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  flightDetails: { departure: { airportCode: string | null }; arrival: { airportCode: string | null } } | null;
};

/**
 * MAP-8: a flight with both airports shows the route, one airport shows that airport; any other
 * event shows its pin when it has one, else its place name. A place name that doesn't already
 * mention the trip's main destination gets it appended, so "Fushimi Inari" finds Kyoto's.
 * Returns null when the event has no place at all.
 */
export function embedTarget(item: EmbedItem, destination: string): EmbedTarget | null {
  const f = item.flightDetails;
  if (f) {
    const from = f.departure.airportCode;
    const to = f.arrival.airportCode;
    if (from && to) return { mode: "directions", origin: `${from} airport`, destination: `${to} airport` };
    const one = to ?? from;
    return one ? { mode: "place", q: `${one} airport` } : null;
  }
  if (item.coordinates) return { mode: "place", q: `${item.coordinates.latitude.toFixed(5)},${item.coordinates.longitude.toFixed(5)}` };
  const place = item.location?.trim();
  if (!place) return null;
  const city = destination.split(",")[0]?.trim().toLowerCase() ?? "";
  return { mode: "place", q: city && !place.toLowerCase().includes(city) ? `${place}, ${destination}` : place };
}

/** The Maps Embed API address for a target. The key is a browser key restricted to this site. */
export function googleEmbedUrl(key: string, t: EmbedTarget): string {
  const k = "key=" + encodeURIComponent(key);
  if (t.mode === "directions") {
    return `https://www.google.com/maps/embed/v1/directions?${k}&origin=${encodeURIComponent(t.origin)}&destination=${encodeURIComponent(t.destination)}&mode=flying`;
  }
  return `https://www.google.com/maps/embed/v1/place?${k}&q=${encodeURIComponent(t.q)}`;
}

/**
 * A road-route stop: saved coordinates, or an airport code for a flight arrival pinned from the
 * bundled airport list. Google names bare coordinates after whatever is nearest (a control tower,
 * a rental listing), so an airport is sent as "HNL airport", as the flight embed already does.
 */
export type RoutePoint = readonly [number, number] | { airport: string };

/** Google-hosted road map for one route segment (up to 20 intermediate stops). */
export function googleDayEmbedUrl(key: string, stops: ReadonlyArray<RoutePoint>, mode: "driving" | "walking"): string | null {
  const points = stops.slice(0, 22);
  const first = points[0];
  if (!first) return null;
  const point = (c: RoutePoint) => ("airport" in c ? `${c.airport} airport` : `${c[0].toFixed(5)},${c[1].toFixed(5)}`);
  const base = `https://www.google.com/maps/embed/v1/`;
  const token = `key=${encodeURIComponent(key)}`;
  if (points.length === 1) return `${base}place?${token}&q=${encodeURIComponent(point(first))}`;
  const last = points[points.length - 1]!;
  const middle = points.slice(1, -1).map(point);
  return `${base}directions?${token}&origin=${encodeURIComponent(point(first))}&destination=${encodeURIComponent(point(last))}` +
    (middle.length ? `&waypoints=${encodeURIComponent(middle.join("|"))}` : "") + `&mode=${mode}`;
}

/** Hand-off for one day (MAP-6): at most the first 10 stops. */
export function googleDayUrl(stops: ReadonlyArray<readonly [number, number]>): string | null {
  const s = stops.slice(0, 10);
  const first = s[0];
  if (!first) return null;
  const f = (c: readonly [number, number]) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
  if (s.length === 1) return googleSearchUrl(f(first));
  const last = s[s.length - 1] as readonly [number, number];
  let url =
    "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(f(first)) + "&destination=" + encodeURIComponent(f(last));
  const mid = s.slice(1, -1).map(f);
  if (mid.length) url += "&waypoints=" + encodeURIComponent(mid.join("|"));
  return url;
}

/** Straight-line distance in kilometres (haversine, R = 6371 km). */
export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
