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
  return url.toString();
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

export function googleSearchUrl(query: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
}

export function googleDirectionsUrl(destination: string): string {
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
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
