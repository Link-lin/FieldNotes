import { describe, expect, it } from "vitest";
import { cleanMapUrl, coordinatesFromMapUrl, embedTarget, googleDayEmbedUrl, googleDayUrl, googleEmbedUrl, haversineKm, mapLinkFromInput, parseCoordinateText, providerLabel } from "@/shared/map-links";

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

describe("embedded event map (MAP-8)", () => {
  const base = { location: null, coordinates: null, flightDetails: null };
  const flight = (from: string | null, to: string | null) => ({ ...base, flightDetails: { departure: { airportCode: from }, arrival: { airportCode: to } } });

  it("shows a flight's route, or its one known airport", () => {
    expect(embedTarget(flight("SFO", "HND"), "Tokyo, Japan")).toEqual({ mode: "directions", origin: "SFO airport", destination: "HND airport" });
    expect(embedTarget(flight(null, "KIX"), "Kyoto, Japan")).toEqual({ mode: "place", q: "KIX airport" });
    expect(embedTarget(flight(null, null), "Kyoto, Japan")).toBeNull();
  });

  it("prefers the pin, then the place name with the trip destination when it isn't mentioned", () => {
    expect(embedTarget({ ...base, location: "Nishiki Market", coordinates: { latitude: 35.005, longitude: 135.765432 } }, "Kyoto, Japan")).toEqual({ mode: "place", q: "35.00500,135.76543" });
    expect(embedTarget({ ...base, location: "Fushimi Inari Taisha" }, "Kyoto, Japan")).toEqual({ mode: "place", q: "Fushimi Inari Taisha, Kyoto, Japan" });
    expect(embedTarget({ ...base, location: "Nishiki Market, kyoto" }, "Kyoto, Japan")).toEqual({ mode: "place", q: "Nishiki Market, kyoto" });
    expect(embedTarget({ ...base, location: "   " }, "Kyoto, Japan")).toBeNull();
  });

  it("builds Maps Embed API addresses with every value encoded", () => {
    expect(googleEmbedUrl("k&1", { mode: "place", q: "Café & bar, Kyoto" })).toBe("https://www.google.com/maps/embed/v1/place?key=k%261&q=Caf%C3%A9%20%26%20bar%2C%20Kyoto");
    expect(googleEmbedUrl("k", { mode: "directions", origin: "SFO airport", destination: "HND airport" })).toBe(
      "https://www.google.com/maps/embed/v1/directions?key=k&origin=SFO%20airport&destination=HND%20airport&mode=flying",
    );
  });
});

describe("embedded day road map (MAP-9)", () => {
  it("uses precise coordinates in stop order and the chosen travel mode", () => {
    const url = new URL(googleDayEmbedUrl("k&1", [[21.33, -157.92], [21.3, -157.86], [21.27, -157.82]], "driving")!);
    expect(url.pathname).toBe("/maps/embed/v1/directions");
    expect(url.searchParams.get("key")).toBe("k&1");
    expect(url.searchParams.get("origin")).toBe("21.33000,-157.92000");
    expect(url.searchParams.get("waypoints")).toBe("21.30000,-157.86000");
    expect(url.searchParams.get("destination")).toBe("21.27000,-157.82000");
    expect(url.searchParams.get("mode")).toBe("driving");
  });

  it("uses a place map for one pin and never includes more than 20 intermediate pins", () => {
    expect(new URL(googleDayEmbedUrl("k", [[21, -157]], "walking")!).pathname).toBe("/maps/embed/v1/place");
    const stops = Array.from({ length: 24 }, (_, i) => [21, -157 + i / 100] as const);
    const url = new URL(googleDayEmbedUrl("k", stops, "walking")!);
    expect(url.searchParams.get("waypoints")?.split("|")).toHaveLength(20);
  });
});

describe("pasted coordinates (MAP-2)", () => {
  it("reads decimal coordinates as Google Maps copies them, with a comma or a space", () => {
    expect(parseCoordinateText("35.01160, 135.76810")).toEqual([35.0116, 135.7681]);
    expect(parseCoordinateText(" -33.8568 151.2153 ")).toEqual([-33.8568, 151.2153]);
    expect(parseCoordinateText("(40.7128,-74.006)")).toEqual([40.7128, -74.006]);
  });

  it("rejects anything that isn't a valid coordinate pair", () => {
    for (const bad of ["95.1, 10", "35.0, 181", "35.0", "35.0, 135.7, 3", "Kyoto 35.0, 135.7", "35°00'41.8\"N 135°46'05.2\"E", ""]) {
      expect(parseCoordinateText(bad)).toBeNull();
    }
  });

  it("stores coordinates as a Google Maps search link that pins the same point", () => {
    const url = mapLinkFromInput("35.01160, 135.76810");
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=35.0116%2C135.7681");
    expect(coordinatesFromMapUrl(url)).toEqual([35.0116, 135.7681]);
    expect(providerLabel(url)).toBe("Google Maps");
    expect(mapLinkFromInput("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
  });
});
