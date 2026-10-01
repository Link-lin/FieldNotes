import { afterEach, describe, expect, it, vi } from "vitest";
import { placeMatches, placeQueries, type GeocodeRow } from "@/server/modules/places/geocode.rules";
import { findPlaceCandidates } from "@/server/modules/places/geocode.service";

const destination = "Maui and Hawaiʻi Island, Hawaii";
const venue = (name: string, extra: Partial<GeocodeRow> = {}): GeocodeRow => ({
  name, address_line1: name, formatted: `${name}, Maui County, HI, United States of America`,
  lat: 20.91, lon: -156.24, county: "Maui County", state: "Hawaii", country: "United States", country_code: "us",
  result_type: "amenity", rank: { confidence: 1 }, ...extra,
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("place queries", () => {
  it("preserves a qualified venue instead of appending the multi-island trip", () => {
    expect(placeQueries("Grand Wailea, Wailea, Maui, Hawaii", destination)[0]).toBe("Grand Wailea, Wailea, Maui, Hawaii");
    expect(placeQueries("Livraria Lello, Porto, Portugal", "Lisbon & Porto")[0]).toBe("Livraria Lello, Porto, Portugal");
    expect(placeQueries("Nishiki Market", "Kyoto, Japan")[0]).toBe("Nishiki Market, Kyoto, Japan");
  });
  it("bounds retries and removes repeated locality text without losing the original query", () => {
    const queries = placeQueries("Twin Falls Maui, Haiku, Maui, Hawaii", destination);
    expect(queries).toEqual(["Twin Falls Maui, Haiku, Maui, Hawaii", "Twin Falls, Haiku, Maui, Hawaii", "Twin Falls, Maui, Hawaii"]);
    expect(placeQueries("Mauna Kea, Hawaiʻi Island, Hawaii", destination)).toEqual(["Mauna Kea, Hawaiʻi Island, Hawaii", "Mauna Kea, Hawaii"]);
  });
});

describe("pin relevance and ambiguity", () => {
  it("keeps street address context and accepts a combined state/postcode qualifier", () => {
    const duke = venue("Duke's Waikiki", { city: "Honolulu", county: "Honolulu County", state_code: "HI", postcode: "96815" });
    expect(placeMatches([duke], "Duke's Waikiki, 2335 Kalākaua Ave, Honolulu", "Hawaii").suggestedIndex).toBe(0);
    const address = { ...duke, name: undefined, formatted: "2169 Kalia Rd, Honolulu, HI 96815, United States", result_type: "building" };
    expect(placeMatches([address], "2169 Kalia Rd, Honolulu, HI 96815", "Hawaii").suggestedIndex).toBe(0);
    expect(placeMatches([{ ...address, postcode: "96814" }], "2169 Kalia Rd, Honolulu, HI 96815", "Hawaii").candidates).toHaveLength(0);
  });
  it("rejects a matching name in the wrong region and streets with an unrelated name", () => {
    const rows = [venue("Twin Falls", { state: "Idaho", county: "Twin Falls County" }), venue("Hawaii Street")];
    expect(placeMatches(rows, "Twin Falls, Maui, Hawaii", destination)).toEqual({ candidates: [], suggestedIndex: null });
    expect(placeMatches([venue("Hawaii", { state: "Laguna", country: "Philippines", county: "Laguna" })], "Waiʻānapanapa State Park, Hana, Maui, Hawaii", destination).candidates).toHaveLength(0);
  });
  it("does not confuse Hawaii Island with a different island in Hawaii", () => {
    expect(placeMatches([venue("Rainbow Falls")], "Rainbow Falls, Hawaiʻi Island, Hawaii", destination).candidates).toHaveLength(0);
  });
  it("suggests an exact named venue with verified locality even below the old .95 cutoff", () => {
    const match = venue("Punalu'u Black Sand Beach", { county: "Hawaiʻi County", rank: { confidence: 0.79 } });
    const result = placeMatches([match, venue("49 Black Sand Beach", { county: "Hawaii County" })], "Punaluʻu Black Sand Beach, Kaʻū, Hawaiʻi Island, Hawaii", destination);
    expect(result.candidates).toHaveLength(1);
    expect(result.suggestedIndex).toBe(0);
  });
  it("does not let a campground displace the requested park", () => {
    const result = placeMatches([venue("Waiʻānapanapa State Park Campground", { lat: 20.8 }), venue("Wai‘ānapanapa State Park")], "Waiʻānapanapa State Park, Hana, Maui, Hawaii", destination);
    expect(result.candidates[0]?.label).toContain("Wai‘ānapanapa State Park,");
    expect(result.suggestedIndex).toBe(0);
  });
  it("leaves two plausible same-name venues far apart for the owner to choose", () => {
    const result = placeMatches([venue("Kilauea Visitor Center"), venue("Kilauea Visitor Center", { lat: 22.23, lon: -159.41, county: "Kauai County", rank: { confidence: 0.7 } })], "Kilauea Visitor Center, Hawaii", "Hawaii");
    expect(result.candidates).toHaveLength(2);
    expect(result.suggestedIndex).toBeNull();
  });
  it("never preselects an area or an unqualified global result", () => {
    expect(placeMatches([venue("Maui", { result_type: "county" })], "Maui, Hawaii", "Hawaii").suggestedIndex).toBeNull();
    expect(placeMatches([venue("Central Park")], "Central Park", "Paris & London").suggestedIndex).toBeNull();
  });
  it("discards invalid coordinates", () => {
    expect(placeMatches([venue("Twin Falls", { lat: 95 }), venue("Twin Falls", { lon: NaN })], "Twin Falls, Maui, Hawaii", destination).candidates).toHaveLength(0);
  });
});

describe("bounded provider lookup", () => {
  it("retries irrelevant results with a simpler query and returns the relevant place", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "test-key");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ results: [venue("Hawaii Street")] }))
      .mockResolvedValueOnce(Response.json({ results: [venue("Twin Falls")] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await findPlaceCandidates("Twin Falls Maui, Haiku, Maui, Hawaii", destination);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.suggestedIndex).toBe(0);
    expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get("text")).toBe("Twin Falls Maui, Haiku, Maui, Hawaii");
  });
  it("returns no pin after bounded unrelated responses", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "test-key");
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ results: [null, venue("Hawaii Street")] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await findPlaceCandidates("Twin Falls Maui, Haiku, Maui, Hawaii", destination)).toEqual({ candidates: [], suggestedIndex: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not retry provider errors or expose the key", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "test-key");
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(findPlaceCandidates("Twin Falls, Maui, Hawaii", destination)).rejects.toMatchObject({ code: "place_lookup_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
