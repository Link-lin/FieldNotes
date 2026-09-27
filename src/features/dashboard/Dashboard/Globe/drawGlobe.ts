import { geoDistance, geoGraticule10, type GeoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import type { TripSummaryDTO } from "@/shared/dto";

const topo = land110 as unknown as Topology;
const LAND = feature(topo, topo.objects.land as GeometryCollection) as GeoPermissibleObjects;
const GRATICULE = geoGraticule10();

/** Trips that share a point on the globe (rounded to 0.01 degree). */
export type Group = { key: string; lon: number; lat: number; trips: TripSummaryDTO[] };
export type Pin = { x: number; y: number; g: Group };
export type GlobeColors = Record<"oceanA" | "oceanB" | "land" | "landLine" | "ink" | "ink3" | "paper" | "card" | "verm", string>;
/**
 * View state. w/h: canvas size; sx/sy/sw/sh: the stage the globe is centred in (on desktop the
 * canvas also runs under the trip column); rot/zoom: the camera; pulse: animation clock.
 */
export type GlobeView = { rot: [number, number]; zoom: number; w: number; h: number; sx: number; sy: number; sw: number; sh: number; dpr: number; pulse: number };

export function groupsOf(trips: TripSummaryDTO[]): Group[] {
  const m = new Map<string, Group>();
  for (const t of trips) {
    if (!t.atlasLocation) continue;
    const key = `${t.atlasLocation.latitude.toFixed(2)},${t.atlasLocation.longitude.toFixed(2)}`;
    const g = m.get(key) ?? { key, lon: t.atlasLocation.longitude, lat: t.atlasLocation.latitude, trips: [] };
    g.trips.push(t);
    m.set(key, g);
  }
  return [...m.values()];
}

/** Draws the globe, graticule, land and one marker per group (status by shape); returns the visible pins. */
export function drawGlobe(ctx: CanvasRenderingContext2D, projection: GeoProjection, path: GeoPath, s: GlobeView, allGroups: Group[], selectedId: string | null, colors: GlobeColors, reduce: boolean): Pin[] {
  if (!s.w) return [];
  const narrow = s.sw < 560;
  const R = (narrow ? Math.min(s.sw * 0.44, s.sh * 0.46) : Math.min(s.sh * 0.43, s.sw * 0.42)) * s.zoom;
  const cx = s.sx + s.sw / 2;
  const cy = s.sy + s.sh / 2;
  projection.scale(R).translate([cx, cy]).rotate([s.rot[0], s.rot[1]]);
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.w, s.h);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.09);
  halo.addColorStop(0, "rgba(255,253,246,0.9)");
  halo.addColorStop(1, "rgba(255,253,246,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.09, 0, 7);
  ctx.fill();
  const ocean = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
  ocean.addColorStop(0, colors.oceanA);
  ocean.addColorStop(1, colors.oceanB);
  ctx.fillStyle = ocean;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 7);
  ctx.fill();
  ctx.beginPath();
  path(GRATICULE);
  ctx.strokeStyle = "rgba(90,120,135,0.13)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  path(LAND);
  ctx.fillStyle = colors.land;
  ctx.fill();
  ctx.strokeStyle = colors.landLine;
  ctx.stroke();
  if (Math.min(cx - s.sx, s.sx + s.sw - cx, cy - s.sy, s.sy + s.sh - cy) > R * 1.13) {
    ctx.save();
    ctx.setLineDash([2, 8]);
    ctx.lineDashOffset = -s.pulse / 120;
    ctx.strokeStyle = colors.landLine;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.13, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  const center: [number, number] = [-s.rot[0], -s.rot[1]];
  const out: Pin[] = [];
  const boxes: Array<[number, number, number, number]> = [];
  const groups = [...allGroups].sort((a, b) => Number(a.trips.some((t) => t.id === selectedId)) - Number(b.trips.some((t) => t.id === selectedId)));
  for (const g of groups) {
    if (geoDistance([g.lon, g.lat], center) > Math.PI / 2 - 0.05) continue;
    const p = projection([g.lon, g.lat]);
    if (!p) continue;
    const [x, y] = p;
    out.push({ x, y, g });
    const sel = g.trips.some((t) => t.id === selectedId);
    const st = g.trips.some((t) => t.status === "upcoming") ? "upcoming" : g.trips[0]!.status;
    if (sel) {
      ctx.save();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -s.pulse / 60;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, 7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = 2;
    if (st === "upcoming") {
      if (!reduce && s.pulse) {
        const k = (s.pulse % 2000) / 2000;
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.55;
        ctx.strokeStyle = colors.verm;
        ctx.beginPath();
        ctx.arc(x, y, 7 + k * 15, 0, 7);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = colors.verm;
      ctx.strokeStyle = colors.paper;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 7);
      ctx.fill();
      ctx.stroke();
    } else if (st === "ongoing") {
      ctx.fillStyle = colors.ink;
      ctx.strokeStyle = colors.paper;
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x + 10, y);
      ctx.lineTo(x, y + 10);
      ctx.lineTo(x - 10, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = colors.paper;
      ctx.strokeStyle = colors.ink3;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    const name = g.trips[0]!.title + (g.trips.length > 1 ? `  +${g.trips.length - 1}` : "");
    ctx.font = "600 11.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const tw = ctx.measureText(name).width;
    let bx = x + 14;
    const by = y - 30;
    const bw = tw + 16;
    if (bx + bw > s.w - 6) bx = x - 14 - bw;
    const clash = boxes.some((b) => bx < b[0] + b[2] && bx + bw > b[0] && by < b[1] + b[3] && by + 22 > b[1]);
    if (!clash || sel) {
      boxes.push([bx, by, bw, 22]);
      ctx.fillStyle = colors.card;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 22, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.textBaseline = "middle";
      ctx.fillText(name, bx + 8, by + 11.5);
    }
  }
  return out;
}
