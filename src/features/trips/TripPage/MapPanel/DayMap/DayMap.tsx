"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { cx as cn } from "@/lib/cx";
import { haversineKm } from "@/shared/map-links";
import { prefersReducedMotion } from "../../day-motion";
import type { Stop } from "../../trip-days";
import { StopNumber } from "../../StopNumber/StopNumber";
import type { MapFocus, MapFocusStore } from "../map-focus";
import { km } from "../StopList/StopList";
import { clampView, fitView, H0, PAD, relaxView, viewOnDay, viewOnStop, W0, type Framing, type View } from "./camera";
import { createCameraDirector, FRAMED, type CameraDirector } from "./camera-director";
import { cityRankLimit, closestPlacesKm, compass, edgePointers, framedStops, homeSpans, project, projectionFor } from "./framing";
import { MAP_CITIES, outlinePaths, outlineProjection } from "./geography";
import styles from "./DayMap.module.css";

/**
 * Kilometres across: the view the map gives one stop it is pointed at, at most; the narrowest it goes there by itself
 * (tighter, an outline map without streets shows nothing but pins); and the narrowest the person can zoom to.
 */
const EVENT_SPAN_KM = 20;
const LOOK_MIN_KM = 6;
const MANUAL_MIN_KM = 1;
/** Stops sharing a marker closer together than this are one venue: the marker lists them instead of zooming in. */
const SAME_VENUE_KM = 0.15;
const HOME: View = { x: 0, y: 0, w: W0, h: H0 };
/** Coordinates in the SVG keep four decimals, which is still a fraction of a pixel when zoomed in a few hundred times. */
const u = (n: number) => Math.round(n * 1e4) / 1e4;
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const farKm = (v: number) => (v >= 1000 ? `${Math.round(v).toLocaleString("en-US")} km` : km(v));

/**
 * Outline day map (MAP-3 to MAP-5): bundled coastlines, country borders and city labels, with
 * no network requests. Pins use a local equirectangular fit; lines join same-day stops. When the page
 * highlights a stop or a day (`focus`), the camera flies there, and eases out a little when the highlight ends
 * (`camera-director.ts`); Reset view flies back to the whole trip.
 */
export function DayMap({ stops, focus, onPin }: { stops: Stop[]; focus: MapFocusStore; onPin: (id: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<View>({ x: 0, y: 0, w: W0, h: H0 });
  const vbRef = useRef(vb);
  useLayoutEffect(() => {
    vbRef.current = vb;
  }, [vb]);
  const director = useRef<CameraDirector | null>(null);
  const resolveRef = useRef<(f: MapFocus, now: View) => View | typeof FRAMED | null>(() => null);
  const relaxRef = useRef<(shown: View) => View>((shown) => shown);
  // The stop the page is highlighting. The marker that holds it lights, however the markers regroup as the camera moves.
  const focused = useSyncExternalStore(focus.subscribe, focus.get, () => null);
  const litId = focused?.kind === "event" ? focused.id : null;
  const [screenW, setScreenW] = useState(0);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; id: number; moved: boolean } | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; w: number } | null>(null);
  const moved = useRef(false);
  // A shared marker (several stops at nearly one place) opens a short list of those stops.
  const [openLead, setOpenLead] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScreenW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stops.length]);

  // The view starts on the stops where the trip happens (framing.ts), at least a few kilometres across and wide enough for
  // the nearest town, in a projection with longitudes unwrapped around their median (antimeridian-safe).
  const fit = useMemo(() => {
    const core = framedStops(stops);
    const proj = projectionFor(stops, core);
    const points = core.map((i) => project(proj, stops[i]!.lon, stops[i]!.lat));
    const towns = points.length ? MAP_CITIES.map(([, lon, lat]) => project(proj, lon, lat)) : [];
    const spans = points.length ? homeSpans(points, towns, { width: W0, innerX: W0 - 2 * PAD - 40, innerY: H0 - 2 * PAD, aspect: H0 / W0 }, closestPlacesKm(stops, core)) : { cx: 0, cy: 0, spanX: 1, spanY: 1 };
    return { core, proj, ...spans };
  }, [stops]);
  const { medianLon: med, kx } = fit.proj;
  const sc = Math.min((W0 - 2 * PAD - 40) / Math.max(fit.spanX, 1e-9), (H0 - 2 * PAD) / Math.max(fit.spanY, 1e-9));
  const cx = fit.cx;
  const cy = fit.cy;
  const projection = useMemo(() => outlineProjection({ medianLon: med, horizontalScale: kx, fitScale: sc, centerX: cx, centerY: cy, width: W0, height: H0 }), [med, kx, sc, cx, cy]);
  const outline = useMemo(() => stops.length ? outlinePaths(projection) : { land: "", borders: "" }, [projection, stops.length]);
  const nearbyCities = useMemo(() => stops.length ? MAP_CITIES.flatMap(([name, lon, lat, rank]) => {
    const at = projection([lon, lat]);
    return at ? [{ name, rank, x: at[0], y: at[1] }] : [];
  }) : [], [projection, stops.length]);
  const all = stops.map((s) => {
    const at = projection([s.lon, s.lat]);
    return { s, x: at?.[0] ?? W0 / 2, y: at?.[1] ?? H0 / 2 };
  });
  // Stops beyond the part of the map that can be shown (half a map past the start view) get a pointer at the edge.
  const reachable = (q: { x: number; y: number }) => q.x >= -W0 * 0.5 && q.x <= W0 * 1.5 && q.y >= -H0 * 0.5 && q.y <= H0 * 1.5;
  const pts = all.filter(reachable);
  const away = all.filter((q) => !reachable(q));
  const pr = stops.length > 5 ? 11 : 14;
  const z = W0 / vb.w;
  // Kilometres in map units (sc is units per degree of latitude).
  const unitsPerKm = sc / 111.32;
  const span = EVENT_SPAN_KM * unitsPerKm;
  const minW = Math.min(W0 / 4, MANUAL_MIN_KM * unitsPerKm);
  const lookMin = Math.min(W0, Math.max(minW, LOOK_MIN_KM * unitsPerKm));
  const k = screenW ? screenW / W0 : 1;
  const mapW = screenW || W0;
  const mapH = mapW * (H0 / W0);

  // Merge pins closer than 14 screen pixels; hide labels that collide.
  const screen = pts.map((p) => ({ x: ((p.x - vb.x) / vb.w) * mapW, y: ((p.y - vb.y) / vb.h) * mapH }));
  const lead: number[] = [];
  const members = new Map<number, number[]>();
  screen.forEach((a, i) => {
    lead[i] = i;
    for (let j = 0; j < i; j++) {
      if (lead[j] === j && Math.hypot(a.x - screen[j]!.x, a.y - screen[j]!.y) < 14) {
        lead[i] = j;
        members.set(j, [...(members.get(j) ?? []), i]);
        break;
      }
    }
  });
  const shown = pts
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => lead[i] === i)
    .map(({ p, i }) => {
      const together = [i, ...(members.get(i) ?? [])].map((g) => pts[g]!.s);
      const group = together.map((s) => s.n);
      const joined = group.join("·");
      // "2·9", or "2+3" (stop 2 and three more) when the numbers don't fit.
      const text = group.length > 1 ? (joined.length <= 5 ? joined : `${group[0]}+${group.length - 1}`) : String(group[0]);
      const r = group.length > 1 ? pr + (text.length > 2 ? 7 : 3) : pr;
      const label = group.length > 1 ? `Stops ${group.join(", ")}` : short(p.s.name);
      return { p, i, group, together, text, r, label, right: p.x < W0 * 0.62 };
    });
  // Stops beyond the map: a pointer on its edge toward each (merged when they'd touch), saying how far it is from the
  // nearest stop on the map. A pointer lights with its row and leads to the event, as a pin does.
  const nearestKm = (s: Stop) => Math.min(...pts.map((q) => haversineKm([q.s.lat, q.s.lon], [s.lat, s.lon])));
  const pointers = edgePointers(away.map((q, index) => ({ index, x: ((q.x - vb.x) / vb.w) * mapW, y: ((q.y - vb.y) / vb.h) * mapH })), mapW, mapH).map((ptr) => {
    const group = ptr.members.map((m) => away[m]!.s).sort((a, b) => a.n - b.n);
    const first = group[0]!;
    const text = group.length > 1 ? `${group.map((s) => s.n).join("·")} · ${group.length} stops` : `${first.n} · ${first.airport ?? short(first.name, 16)}`;
    const dist = farKm(Math.min(...group.map(nearestKm)));
    // Kept whole inside the map, however close to a corner its point falls.
    const half = ((text.length + dist.length + 3) * 6.4 + 30) / 2;
    return { ...ptr, group, first, text, dist, half, left: Math.max(half + 4, Math.min(mapW - half - 4, ptr.x)), top: Math.max(16, Math.min(mapH - 16, ptr.y)) };
  });

  // Labels keep clear of those pointers as they do of each other.
  const placed: Array<{ x: number; y: number; w: number; h: number }> = pointers.map((ptr) => ({ x: ptr.left - ptr.half, y: ptr.top - 12, w: ptr.half * 2, h: 24 }));
  const circles = shown.map((d) => ({ x: screen[d.i]!.x, y: screen[d.i]!.y, r: (d.r + 2) * k }));
  const labelOn = shown.map((d, ix) => {
    const c = circles[ix]!;
    const w = d.label.length * 6.8 * k;
    const h = 16 * k;
    const off = (d.r + 6) * k;
    const bx = d.right ? c.x + off : c.x - off - w;
    const by = c.y - 8 * k;
    let ok = !placed.some((q) => bx < q.x + q.w && bx + w > q.x && by < q.y + q.h && by + h > q.y);
    if (ok) ok = !circles.some((q, j) => j !== ix && bx < q.x + q.r && bx + w > q.x - q.r && by < q.y + q.r && by + h > q.y - q.r);
    if (ok) placed.push({ x: bx, y: by, w, h });
    return ok;
  });

  const open = shown.find((d) => d.p.s.id === openLead && d.group.length > 1) ?? null;
  const openAt = open ? screen[open.i]! : null;
  useEffect(() => {
    if (!openLead) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!list.current?.contains(t) && !t?.closest?.(`[data-pin="${CSS.escape(openLead)}"]`)) setOpenLead(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openLead]);
  const pinFor = (id: string) => svg.current?.querySelector<SVGGElement>(`[data-pin="${CSS.escape(id)}"]`) ?? null;
  function closeList(refocus: boolean) {
    const lead = openLead;
    setOpenLead(null);
    if (refocus && lead) requestAnimationFrame(() => pinFor(lead)?.focus());
  }
  function activate(d: (typeof shown)[number]) {
    if (d.group.length < 2) {
      onPin(d.p.s.id);
      return;
    }
    // Stops that share a marker only because the view is wide: zoom in until they part. At one venue, list them.
    const members = d.together.flatMap((s) => pts.filter((q) => q.s.id === s.id));
    const apart = members.some((a) => members.some((b) => haversineKm([a.s.lat, a.s.lon], [b.s.lat, b.s.lon]) > SAME_VENUE_KM));
    if (apart) {
      setOpenLead(null);
      director.current?.glide(clampView(fitView(members, minW)));
      return;
    }
    const opening = openLead !== d.p.s.id;
    setOpenLead(opening ? d.p.s.id : null);
    if (opening) requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  // City labels stay the same screen size while zooming. Prominent cities show first, smaller
  // ones become eligible when zoomed in, and none cover a stop pin or a stop label.
  const cityLabels: Array<{ name: string; x: number; y: number }> = [];
  const labelBoxes = [...placed];
  const rankLimit = cityRankLimit(vb.w / unitsPerKm);
  for (const city of nearbyCities) {
    if (city.rank > rankLimit) continue;
    const x = ((city.x - vb.x) / vb.w) * (screenW || W0);
    const y = ((city.y - vb.y) / vb.h) * ((screenW || W0) * (H0 / W0));
    if (x < 12 * k || x > (screenW || W0) - 12 * k || y < 12 * k || y > (screenW || W0) * (H0 / W0) - 12 * k) continue;
    const box = { x: x + 5 * k, y: y - 11 * k, w: (city.name.length * 5.8 + 4) * k, h: 13 * k };
    if (circles.some((c) => box.x < c.x + c.r + 5 * k && box.x + box.w > c.x - c.r - 5 * k && box.y < c.y + c.r + 5 * k && box.y + box.h > c.y - c.r - 5 * k)) continue;
    if (labelBoxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
    labelBoxes.push(box);
    cityLabels.push({ name: city.name, x: city.x, y: city.y });
    if (cityLabels.length >= 10) break;
  }

  // Scale bar: largest round distance under ~90 px.
  const mpx = ((111320 / sc) * vb.w) / (screenW || W0);
  let pick = NICE[0]!;
  for (const n of NICE) if (n / mpx <= 90) pick = n;

  function zoomTo(ux: number, uy: number, nw: number): boolean {
    const cur = vb;
    const w = Math.max(minW, Math.min(W0 * 2, nw));
    if (Math.abs(w - cur.w) < cur.w * 1e-4) return false;
    const h = (w * H0) / W0;
    director.current?.takeOver();
    setOpenLead(null); // the list would no longer sit beside its marker
    setVb(clampView({ x: ux - ((ux - cur.x) * w) / cur.w, y: uy - ((uy - cur.y) * h) / cur.h, w, h }));
    return true;
  }
  function toUser(clientX: number, clientY: number): [number, number] {
    const r = svg.current!.getBoundingClientRect();
    const cur = vb;
    return [cur.x + ((clientX - r.left) / r.width) * cur.w, cur.y + ((clientY - r.top) / r.height) * cur.h];
  }

  // Where to look for what the page highlights, and how far to ease out after it; read through refs so the director
  // outlives re-renders.
  useLayoutEffect(() => {
    resolveRef.current = (f, now) => {
      if (!pts.length) return null;
      const framing: Framing = { home: HOME, span, floor: lookMin, pixels: screenW || W0 };
      if (f.kind === "event") {
        const at = pts.find((q) => q.s.id === f.id);
        // A stop beyond the map stays there: its pointer at the edge lights instead.
        if (!at) return away.some((q) => q.s.id === f.id) ? FRAMED : null;
        return viewOnStop(at, now, framing, pts.filter((q) => q !== at)) ?? FRAMED;
      }
      const day = pts.filter((q) => q.s.day === f.day);
      return day.length ? (viewOnDay(day, now, framing) ?? FRAMED) : away.some((q) => q.s.day === f.day) ? FRAMED : null;
    };
    relaxRef.current = (shown) => (pts.length ? relaxView(shown, HOME) : shown);
  });
  useEffect(() => {
    const d = createCameraDirector({
      clock: {
        now: () => performance.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
        requestFrame: (fn) => requestAnimationFrame(fn),
        cancelFrame: (id) => cancelAnimationFrame(id as number),
      },
      view: () => vbRef.current,
      // Each frame is committed before the browser paints, so the pins and labels keep step with the map.
      show: (v) => flushSync(() => { setOpenLead(null); setVb(clampView(v)); }),
      resolve: (f, now) => resolveRef.current(f, now),
      relax: (shown) => relaxRef.current(shown),
      instant: prefersReducedMotion,
      visible: () => {
        const r = svg.current?.getBoundingClientRect();
        return !!r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      },
    });
    director.current = d;
    const stopWatching = focus.subscribe(() => d.point(focus.get()));
    return () => {
      stopWatching();
      d.dispose();
      director.current = null;
    };
  }, [focus]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const [ux, uy] = toUser(e.clientX, e.clientY);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      if (zoomTo(ux, uy, vb.w * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0018)))) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onDown(e: React.PointerEvent) {
    director.current?.takeOver();
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: vb.w };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, id: e.pointerId, moved: false };
      moved.current = false;
    }
  }
  function onMove(e: React.PointerEvent) {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const [ux, uy] = toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomTo(ux, uy, (pinch.current.w * pinch.current.d) / (Math.hypot(a.x - b.x, a.y - b.y) || 1));
      moved.current = true;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      moved.current = true;
      svg.current?.setPointerCapture(d.id);
    }
    if (d.moved) {
      const r = svg.current!.getBoundingClientRect();
      const cur = vb;
      setOpenLead(null);
      setVb(clampView({ ...cur, x: d.vx - (dx / r.width) * cur.w, y: d.vy - (dy / r.height) * cur.h }));
    }
  }
  function onUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (!ptrs.current.size) drag.current = null;
  }

  if (!stops.length) {
    return (
      <div className={styles.empty}>
        <b>No places on this map yet</b>
        <span>Events appear here once they have a pin: from a map link, a place found by name, or a flight&apos;s arrival airport.</span>
      </div>
    );
  }

  // Route lines: consecutive non-flight stops of the same day.
  const runs: Array<typeof pts> = [];
  let run: typeof pts = [];
  for (const p of pts) {
    if (p.s.flight) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    if (run.length && run[run.length - 1]!.s.day !== p.s.day) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length > 1) runs.push(run);

  return (
      <div className={styles.wrap} onPointerEnter={() => director.current?.hold()} onPointerLeave={() => director.current?.release()}>
        <svg
          ref={svg}
          className={styles.map}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          role="group"
          aria-label="Outline map with coastlines, country borders, cities and the stops in order. Use the plus and minus buttons, the mouse wheel or a pinch to zoom, and drag to move."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClickCapture={(e) => {
            if (moved.current) {
              e.stopPropagation();
              e.preventDefault();
              moved.current = false;
            }
          }}
        >
          <defs>
            <pattern className={styles.grid} id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" />
            </pattern>
          </defs>
          {z < 16 ? <rect x={-2000} y={-2000} width={4400} height={4340} fill="url(#map-grid)" /> : null}
          <path className={styles.land} d={outline.land} />
          <path className={styles.borders} d={outline.borders} />
          {runs.map((r, i) => (
            <polyline key={i} className={styles.route} points={r.map((p) => `${u(p.x)},${u(p.y)}`).join(" ")} />
          ))}
          {cityLabels.map((city) => (
            <g key={`${city.name}-${city.x}-${city.y}`} className={styles.city} transform={`translate(${u(city.x)} ${u(city.y)}) scale(${1 / z})`} aria-hidden="true">
              <circle r={2} />
              <text x={5} y={-3}>{city.name}</text>
            </g>
          ))}
          {shown.map((d, ix) => (
            <g
              key={d.p.s.id}
              className={styles.pin}
              data-hl={d.p.s.id}
              data-hl-also={d.group.length > 1 ? d.together.slice(1).map((s) => s.id).join(" ") : undefined}
              data-lit={litId !== null && d.together.some((s) => s.id === litId) ? "" : undefined}
              transform={`translate(${u(d.p.x)} ${u(d.p.y)}) scale(${1 / z})`}
              data-pin={d.p.s.id}
              tabIndex={0}
              role="button"
              aria-label={d.group.length > 1 ? `Stops ${d.group.join(", ")}, at nearly the same place` : `Stop ${d.p.s.n}: ${d.p.s.name}`}
              aria-haspopup={d.group.length > 1 ? "dialog" : undefined}
              aria-expanded={d.group.length > 1 ? openLead === d.p.s.id : undefined}
              onClick={() => activate(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate(d);
                }
              }}
            >
              <circle className={cn(styles.dot, d.p.s.need && styles.need)} r={d.r} />
              <text className={styles.pinNum} style={{ fontSize: d.text.length > 2 ? 10 : pr > 12 ? 13 : 11 }}>{d.text}</text>
              {labelOn[ix] ? (
                <text className={styles.pinLabel} x={d.right ? d.r + 6 : -(d.r + 6)} y={4} textAnchor={d.right ? "start" : "end"}>
                  {d.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {open && openAt ? (
          <div
            ref={list}
            className={styles.stops}
            role="dialog"
            aria-label={`Stops ${open.group.join(", ")}, at nearly the same place`}
            style={{ left: Math.max(8, Math.min(openAt.x + (open.r + 8) * k, (screenW || W0) - 288)), top: Math.max(8, openAt.y - 18) }}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              closeList(true);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpenLead(null);
            }}
          >
            <p className={styles.stopsHead}>Same place · {open.group.length} stops</p>
            <ul>
              {open.together.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      closeList(true);
                      onPin(s.id);
                    }}
                  >
                    <StopNumber n={s.n} need={s.need} />
                    <span>{s.name}</span>
                    <span className={styles.stopsDay}>{s.dayLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {pointers.map((ptr) => (
          <button
            key={ptr.first.id}
            type="button"
            className={styles.away}
            data-hl={ptr.first.id}
            data-hl-also={ptr.group.length > 1 ? ptr.group.slice(1).map((s) => s.id).join(" ") : undefined}
            style={{ left: ptr.left, top: ptr.top }}
            aria-label={`${ptr.group.length > 1 ? `Stops ${ptr.group.map((s) => s.n).join(", ")}` : `Stop ${ptr.first.n}: ${ptr.first.name}`}, ${ptr.dist} to the ${compass(ptr.angle)}, beyond this map`}
            onClick={() => onPin(ptr.first.id)}
          >
            <span className={styles.awayArrow} style={{ transform: `rotate(${Math.round(ptr.angle)}deg)` }} aria-hidden="true">→</span>
            <span>{ptr.text}</span>
            <span className={styles.awayKm}>{ptr.dist}</span>
          </button>
        ))}
        <div className={styles.controls}>
          <span className={styles.zoom}>
            <button type="button" aria-label="Zoom in on the map" disabled={vb.w < minW * 1.01} onClick={() => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, vb.w / 1.5)}>+</button>
            <button type="button" aria-label="Zoom out on the map" disabled={z < 0.51} onClick={() => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, vb.w * 1.5)}>−</button>
          </span>
          <span className={styles.scale}>
            <i style={{ width: Math.max(8, pick / mpx) }} />
            <span className="mono">{pick >= 1000 ? `${pick / 1000} km` : `${pick} m`}</span>
          </span>
          <svg className={styles.north} viewBox="0 0 22 40" aria-hidden="true">
            <path d="M11 30V6M5 13l6-8 6 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="11" y="40" textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="currentColor">N</text>
          </svg>
          {Math.abs(z - 1) > 0.02 ? (
            <button className={cn("mono", styles.reset)} type="button" onClick={() => director.current?.glide({ x: 0, y: 0, w: W0, h: H0 })}>Reset view</button>
          ) : null}
        </div>
      </div>
  );
}
