import { describe, expect, it } from "vitest";
import { cleanMapUrl, coordinatesFromMapUrl, googleDayUrl, haversineKm, providerLabel } from "@/shared/map-links";

describe("provider labels (MAP-1)", () => {
  it("names known providers by exact host", () => {
    expect(providerLabel("https://www.google.com/maps/place/X/@35.1,139.1,15z")).toBe("Google Maps");
    expect(providerLabel("https://maps.google.co.jp/?q=35,139")).toBe("Google Maps");
    expect(providerLabel("https://maps.app.goo.gl/abc")).toBe("Google Maps");
    expect(providerLabel("https://maps.apple.com/?ll=35,139")).toBe("Apple Maps");
    expect(providerLabel("https://www.openstreetmap.org/#map=16/34.9/135.7")).toBe("OpenStreetMap");
    expect(providerLabel("https://www.amap.com/place/x")).toBe("Amap");
  });
  it("labels look-alike hosts by their real host", () => {
    expect(providerLabel("https://google.com.evil.example/maps/@35,139,15z")).toBe("google.com.evil.example");
    expect(providerLabel("https://evil.example/google.com/maps")).toBe("evil.example");
    expect(providerLabel("https://www.google.com/search?q=maps")).toBe("www.google.com");
  });
});

describe("saving a map link", () => {
  it("rejects non-https links and links with user information", () => {
    expect(cleanMapUrl("http://www.google.com/maps/@35,139,15z")).toBeNull();
    expect(cleanMapUrl("https://user@maps.google.com/?q=1,2")).toBeNull();
    expect(cleanMapUrl("javascript:alert(1)")).toBeNull();
  });
  it("strips tracking parameters", () => {
    expect(cleanMapUrl("https://www.google.com/maps/place/X/@35.6951,139.701,17z?entry=ttu&g_ep=abc&hl=en")).toBe(
      "https://www.google.com/maps/place/X/@35.6951,139.701,17z?hl=en",
    );
  });
});

describe("coordinates (MAP-2)", () => {
  it("reads documented Google, Apple and OpenStreetMap formats", () => {
    expect(coordinatesFromMapUrl("https://www.google.com/maps/place/X/@35.6951,139.7010,17z")).toEqual([35.6951, 139.701]);
    expect(coordinatesFromMapUrl("https://www.google.com/maps/place/X/data=!3d34.9671!4d135.7727")).toEqual([34.9671, 135.7727]);
    expect(coordinatesFromMapUrl("https://www.openstreetmap.org/?mlat=34.9671&mlon=135.7727#map=16/34.9671/135.7727")).toEqual([34.9671, 135.7727]);
    expect(coordinatesFromMapUrl("https://maps.apple.com/?ll=38.7139,-9.1335&q=Alfama")).toEqual([38.7139, -9.1335]);
    expect(coordinatesFromMapUrl("https://www.google.com/maps/search/?api=1&query=40.7061%2C-73.9969")).toEqual([40.7061, -73.9969]);
  });
  it("never pins shortened, Amap, Baidu, look-alike or out-of-range links", () => {
    expect(coordinatesFromMapUrl("https://maps.app.goo.gl/abc?q=35,139")).toBeNull();
    expect(coordinatesFromMapUrl("https://www.amap.com/?q=39.9,116.4")).toBeNull();
    expect(coordinatesFromMapUrl("https://map.baidu.com/@12958160,4825907,13z")).toBeNull();
    expect(coordinatesFromMapUrl("https://google.com.evil.example/maps/@35.1,139.1,15z")).toBeNull();
    expect(coordinatesFromMapUrl("https://www.google.com/maps/@95.1,139.1,15z")).toBeNull();
  });
});

describe("day hand-off (MAP-6)", () => {
  it("uses at most the first 10 stops", () => {
    const stops = Array.from({ length: 12 }, (_, i) => [35 + i / 100, 139] as const);
    const url = new URL(googleDayUrl(stops)!);
    expect(url.searchParams.get("origin")).toBe("35.00000,139.00000");
    expect(url.searchParams.get("destination")).toBe("35.09000,139.00000");
    expect(url.searchParams.get("waypoints")!.split("|")).toHaveLength(8);
  });
  it("measures straight-line distance", () => {
    expect(Math.round(haversineKm([34.9671, 135.7727], [35.0037, 135.7756]))).toBe(4);
  });
});

describe("cleanMapUrl length", () => {
  it("rejects a link that grows past 2048 characters when normalized", () => {
    expect(cleanMapUrl(`https://maps.google.com/?q=${"é".repeat(400)}`)).toBeNull();
    expect(cleanMapUrl("https://maps.google.com/?q=Kyoto&utm_source=x")).toBe("https://maps.google.com/?q=Kyoto");
  });
});
