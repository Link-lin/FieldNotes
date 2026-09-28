import { geoPath, geoProjection, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries10 from "world-atlas/countries-10m.json";
import land10 from "world-atlas/land-10m.json";
import cities from "@/data/map-cities.json";

const topology = countries10 as unknown as Topology;
const countries = topology.objects.countries as GeometryCollection;

// Natural Earth geometry is bundled with the app. Neither layer fetches tiles or sends stops
// to a map provider. The land outline has a projected exterior ring; the SVG paints that ring
// as water over a land background so coastlines stay correct across the supported pan range.
const landTopology = land10 as unknown as Topology;
const land = feature(landTopology, landTopology.objects.land as GeometryCollection) as GeoPermissibleObjects;
const borders = mesh(topology, countries, (a, b) => a !== b) as GeoPermissibleObjects;

/** Name, longitude, latitude, Natural Earth label rank (lower means more prominent). */
export const MAP_CITIES = cities as unknown as Array<readonly [string, number, number, number]>;

/** Match the stop map's locally distance-corrected equirectangular fit. */
export function outlineProjection(input: {
  medianLon: number;
  horizontalScale: number;
  fitScale: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}): GeoProjection {
  const { medianLon, horizontalScale, fitScale, centerX, centerY, width, height } = input;
  return geoProjection((lon: number, lat: number): [number, number] => [lon * horizontalScale, lat])
    .rotate([-medianLon, 0])
    .scale((fitScale * 180) / Math.PI)
    .translate([width / 2 + (medianLon * horizontalScale - centerX) * fitScale, height / 2 - centerY * fitScale])
    // The user can pan half a map beyond the initial view. Clip the geometry there rather than
    // building SVG paths for every coastline in the world at a local stop's scale.
    .clipExtent([[-width / 2, -height / 2], [width * 1.5, height * 1.5]]);
}

export function outlinePaths(projection: GeoProjection): { land: string; borders: string } {
  const path = geoPath(projection);
  return { land: path(land) ?? "", borders: path(borders) ?? "" };
}
