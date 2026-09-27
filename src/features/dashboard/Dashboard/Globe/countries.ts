import { geoArea, geoCentroid, type GeoPermissibleObjects } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import countries110 from "world-atlas/countries-110m.json";

/** Country outlines and label anchors from the bundled Natural Earth 110m data (public domain). */
const topo = countries110 as unknown as Topology;
const objects = topo.objects.countries as GeometryCollection<{ name: string }>;

/** Shared borders between countries (coastlines are drawn with the land). */
export const BORDERS = mesh(topo, objects, (a, b) => a !== b) as GeoPermissibleObjects;

export type CountryLabel = { name: string; at: [number, number]; area: number };

/**
 * One label per country, placed at the centroid of its largest polygon (so France sits in
 * Europe, not between Europe and French Guiana). `area` is in steradians; sorted largest first
 * so bigger countries win when labels would overlap.
 */
export const COUNTRY_LABELS: CountryLabel[] = (feature(topo, objects).features as Array<Feature<Polygon | MultiPolygon, { name: string }>>)
  .filter((f) => f.geometry && f.properties?.name)
  .map((f) => {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let best = polys[0]!;
    let bestArea = -1;
    for (const p of polys) {
      const a = geoArea({ type: "Polygon", coordinates: p });
      if (a > bestArea) [best, bestArea] = [p, a];
    }
    return { name: f.properties.name, at: geoCentroid({ type: "Polygon", coordinates: best }) as [number, number], area: bestArea };
  })
  .sort((a, b) => b.area - a.area);
