"use client";

import { useEffect, useRef, useState } from "react";
import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import type { TripSummaryDTO } from "@/shared/dto";
import { dateRangeLabel, STATUS_LABEL } from "./format";
import { MinusIcon, PlusIcon, ResetIcon, StatusIcon } from "./icons";

const topo = land110 as unknown as Topology;
const LAND = feature(topo, topo.objects.land as GeometryCollection) as GeoPermissibleObjects;
const GRATICULE = geoGraticule10();
const HOME: [number, number] = [-96, -26]; // rotation that centers Asia

type Group = { key: string; lon: number; lat: number; trips: TripSummaryDTO[] };
type Props = {
  trips: TripSummaryDTO[];
  selectedId: string | null;
  focusKey: number;
  onSelect: (id: string | null, fromGlobe: boolean) => void;
};

function groupsOf(trips: TripSummaryDTO[]): Group[] {
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

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Dashboard globe (ATLAS-1, ATLAS-6): bundled Natural Earth land on a canvas, one
 * marker per located trip, status by shape. The trip list is the complete alternative.
 */
export function Globe({ trips, selectedId, focusKey, onSelect }: Props) {
  const wrap = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const callout = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const state = useRef({ rot: [HOME[0] + 90, HOME[1] + 14] as [number, number], zoom: 0.8, w: 0, h: 0, sx: 0, sy: 0, sw: 0, sh: 0, dpr: 1, pulse: 0, lastAct: 0, anim: 0, intro: true });
  const data = useRef({ trips, selectedId, groups: groupsOf(trips) });
  const pins = useRef<Array<{ x: number; y: number; g: Group }>>([]);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const drawRef = useRef<() => void>(() => {});
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) {
      setFailed(true);
      return;
    }
    const s = state.current;
    const colors = { oceanA: css("--ocean-a"), oceanB: css("--ocean-b"), land: css("--land"), landLine: css("--land-line"), ink: css("--ink"), ink3: css("--ink-3"), paper: css("--paper"), card: css("--card"), verm: css("--vermilion") };
    const projection = geoOrthographic().clipAngle(90).precision(0.3);
    const path = geoPath(projection, ctx);

    function layout() {
      const r = el!.getBoundingClientRect();
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = r.width;
      s.h = r.height;
      el!.width = Math.round(r.width * s.dpr);
      el!.height = Math.round(r.height * s.dpr);
      // The globe is centered in the stage; beyond it (under the trip list on desktop) it may
      // spill when zoomed, drawn faintly behind the list.
      const st = stage.current?.getBoundingClientRect();
      s.sx = st ? st.left - r.left : 0;
      s.sy = st ? st.top - r.top : 0;
      s.sw = st?.width || r.width;
      s.sh = st?.height || r.height;
    }

    function draw() {
      if (!s.w) return;
      const narrow = s.sw < 560;
      const R = (narrow ? Math.min(s.sw * 0.44, s.sh * 0.46) : Math.min(s.sh * 0.43, s.sw * 0.42)) * s.zoom;
      const cx = s.sx + s.sw / 2;
      const cy = s.sy + s.sh / 2;
      projection.scale(R).translate([cx, cy]).rotate([s.rot[0], s.rot[1]]);
      ctx!.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx!.clearRect(0, 0, s.w, s.h);
      const halo = ctx!.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.09);
      halo.addColorStop(0, "rgba(255,253,246,0.9)");
      halo.addColorStop(1, "rgba(255,253,246,0)");
      ctx!.fillStyle = halo;
      ctx!.beginPath();
      ctx!.arc(cx, cy, R * 1.09, 0, 7);
      ctx!.fill();
      const ocean = ctx!.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
      ocean.addColorStop(0, colors.oceanA);
      ocean.addColorStop(1, colors.oceanB);
      ctx!.fillStyle = ocean;
      ctx!.beginPath();
      ctx!.arc(cx, cy, R, 0, 7);
      ctx!.fill();
      ctx!.beginPath();
      path(GRATICULE);
      ctx!.strokeStyle = "rgba(90,120,135,0.13)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.beginPath();
      path(LAND);
      ctx!.fillStyle = colors.land;
      ctx!.fill();
      ctx!.strokeStyle = colors.landLine;
      ctx!.stroke();
      if (Math.min(cx - s.sx, s.sx + s.sw - cx, cy - s.sy, s.sy + s.sh - cy) > R * 1.13) {
        ctx!.save();
        ctx!.setLineDash([2, 8]);
        ctx!.lineDashOffset = -s.pulse / 120;
        ctx!.strokeStyle = colors.landLine;
        ctx!.globalAlpha = 0.8;
        ctx!.beginPath();
        ctx!.arc(cx, cy, R * 1.13, 0, 7);
        ctx!.stroke();
        ctx!.restore();
      }

      const center: [number, number] = [-s.rot[0], -s.rot[1]];
      const out: typeof pins.current = [];
      const boxes: Array<[number, number, number, number]> = [];
      const groups = [...data.current.groups].sort((a, b) => Number(a.trips.some((t) => t.id === data.current.selectedId)) - Number(b.trips.some((t) => t.id === data.current.selectedId)));
      for (const g of groups) {
        if (geoDistance([g.lon, g.lat], center) > Math.PI / 2 - 0.05) continue;
        const p = projection([g.lon, g.lat]);
        if (!p) continue;
        const [x, y] = p;
        out.push({ x, y, g });
        const sel = g.trips.some((t) => t.id === data.current.selectedId);
        const st = g.trips.some((t) => t.status === "upcoming") ? "upcoming" : g.trips[0]!.status;
        if (sel) {
          ctx!.save();
          ctx!.strokeStyle = colors.ink;
          ctx!.lineWidth = 1.5;
          ctx!.setLineDash([4, 4]);
          ctx!.lineDashOffset = -s.pulse / 60;
          ctx!.beginPath();
          ctx!.arc(x, y, 16, 0, 7);
          ctx!.stroke();
          ctx!.restore();
        }
        ctx!.lineWidth = 2;
        if (st === "upcoming") {
          if (!reduce && s.pulse) {
            const k = (s.pulse % 2000) / 2000;
            ctx!.save();
            ctx!.globalAlpha = (1 - k) * 0.55;
            ctx!.strokeStyle = colors.verm;
            ctx!.beginPath();
            ctx!.arc(x, y, 7 + k * 15, 0, 7);
            ctx!.stroke();
            ctx!.restore();
          }
          ctx!.fillStyle = colors.verm;
          ctx!.strokeStyle = colors.paper;
          ctx!.beginPath();
          ctx!.arc(x, y, 7, 0, 7);
          ctx!.fill();
          ctx!.stroke();
        } else if (st === "ongoing") {
          ctx!.fillStyle = colors.ink;
          ctx!.strokeStyle = colors.paper;
          ctx!.beginPath();
          ctx!.moveTo(x, y - 10);
          ctx!.lineTo(x + 10, y);
          ctx!.lineTo(x, y + 10);
          ctx!.lineTo(x - 10, y);
          ctx!.closePath();
          ctx!.fill();
          ctx!.stroke();
        } else {
          ctx!.fillStyle = colors.paper;
          ctx!.strokeStyle = colors.ink3;
          ctx!.lineWidth = 2.5;
          ctx!.beginPath();
          ctx!.arc(x, y, 6, 0, 7);
          ctx!.fill();
          ctx!.stroke();
        }
        const name = g.trips[0]!.title + (g.trips.length > 1 ? `  +${g.trips.length - 1}` : "");
        ctx!.font = "600 11.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        const tw = ctx!.measureText(name).width;
        let bx = x + 14;
        const by = y - 30;
        const bw = tw + 16;
        if (bx + bw > s.w - 6) bx = x - 14 - bw;
        const clash = boxes.some((b) => bx < b[0] + b[2] && bx + bw > b[0] && by < b[1] + b[3] && by + 22 > b[1]);
        if (!clash || sel) {
          boxes.push([bx, by, bw, 22]);
          ctx!.fillStyle = colors.card;
          ctx!.strokeStyle = colors.ink;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.roundRect(bx, by, bw, 22, 8);
          ctx!.fill();
          ctx!.stroke();
          ctx!.fillStyle = colors.ink;
          ctx!.textBaseline = "middle";
          ctx!.fillText(name, bx + 8, by + 11.5);
        }
      }
      pins.current = out;
      // Keep the callout next to the selected marker.
      const c = callout.current;
      const selPin = out.find((p) => p.g.trips.some((t) => t.id === data.current.selectedId));
      if (c) {
        if (!selPin) c.style.visibility = "hidden";
        else {
          c.style.visibility = "visible";
          const pw = c.offsetWidth;
          const ph = c.offsetHeight;
          let x = selPin.x + 24;
          if (x + pw > s.w - 8) x = selPin.x - pw - 24;
          c.style.left = `${Math.max(s.sx + 8, Math.min(s.w - pw - 8, x))}px`;
          c.style.top = `${Math.max(8, Math.min(s.h - ph - 8, selPin.y - ph / 2))}px`;
        }
      }
    }
    drawRef.current = draw;

    const touch = () => {
      s.lastAct = performance.now();
      s.intro = false;
      setHintGone(true);
    };
    let drag: { x: number; y: number; rot: [number, number]; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      touch();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, rot: [...s.rot] as [number, number], moved: false };
      cancelAnimationFrame(s.anim);
    };
    const onMove = (e: PointerEvent) => {
      s.lastAct = performance.now();
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const k = 60 / (Math.min(s.sw, s.sh) * 0.43 * s.zoom);
      s.rot = [drag.rot[0] + dx * k, Math.max(-80, Math.min(80, drag.rot[1] - dy * k))];
      draw();
    };
    const onUp = (e: PointerEvent) => {
      const click = drag && !drag.moved;
      drag = null;
      if (!click) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let best: (typeof pins.current)[number] | null = null;
      let bd = 22;
      for (const p of pins.current) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      onSelectRef.current(best ? best.g.trips[0]!.id : null, true);
    };
    const onWheel = (e: WheelEvent) => {
      touch();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const next = Math.max(0.8, Math.min(4, s.zoom * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018))));
      if (next === s.zoom) return; // let the page scroll at the limits
      e.preventDefault();
      s.zoom = next;
      draw();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      let used = true;
      if (k === "ArrowLeft") s.rot = [s.rot[0] + 10, s.rot[1]];
      else if (k === "ArrowRight") s.rot = [s.rot[0] - 10, s.rot[1]];
      else if (k === "ArrowUp") s.rot = [s.rot[0], Math.max(-80, s.rot[1] - 8)];
      else if (k === "ArrowDown") s.rot = [s.rot[0], Math.min(80, s.rot[1] + 8)];
      else if (k === "+" || k === "=") s.zoom = Math.min(4, s.zoom * 1.2);
      else if (k === "-") s.zoom = Math.max(0.8, s.zoom / 1.2);
      else if (k === "0") {
        s.rot = [...HOME];
        s.zoom = 1;
      } else used = false;
      if (used) {
        e.preventDefault();
        touch();
        draw();
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(wrap.current!);
    layout();

    // One short intro turn, then a decorative pulse that stops 10 s after the last interaction.
    const start = performance.now();
    s.lastAct = start;
    if (reduce) {
      s.rot = [...HOME];
      s.zoom = 1;
      draw();
    }
    let frame = 0;
    let idleDrawn = false;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (reduce || document.hidden) return;
      if (s.intro) {
        const k = Math.min(1, (now - start) / 1800);
        const e = 1 - Math.pow(1 - k, 3);
        s.rot = [HOME[0] + 90 * (1 - e), HOME[1] + 14 * (1 - e)];
        s.zoom = 0.8 + 0.2 * e;
        if (k >= 1) s.intro = false;
        draw();
        return;
      }
      if (now - s.lastAct > 10000) {
        if (!idleDrawn) {
          idleDrawn = true;
          s.pulse = 0;
          draw();
        }
        return;
      }
      idleDrawn = false;
      if (now - s.pulse < 33) return;
      s.pulse = now;
      draw();
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(s.anim);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
    };
  }, [reduce]);

  // Keep the latest props for the canvas handlers, then redraw.
  useEffect(() => {
    onSelectRef.current = onSelect;
    data.current = { trips, selectedId, groups: groupsOf(trips) };
    drawRef.current();
  }, [trips, selectedId, onSelect]);
  useEffect(() => {
    if (!focusKey || !selectedId) return;
    const t = trips.find((x) => x.id === selectedId);
    if (!t?.atlasLocation) return;
    const s = state.current;
    s.intro = false;
    s.lastAct = performance.now();
    const target: [number, number] = [-t.atlasLocation.longitude, -Math.max(-45, Math.min(50, t.atlasLocation.latitude))];
    if (reduce) {
      s.rot = target;
      drawRef.current();
      return;
    }
    const from = [...s.rot] as [number, number];
    const dLon = ((target[0] - from[0] + 540) % 360) - 180;
    const t0 = performance.now();
    cancelAnimationFrame(s.anim);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      s.rot = [from[0] + dLon * e, from[1] + (target[1] - from[1]) * e];
      drawRef.current();
      if (k < 1) s.anim = requestAnimationFrame(step);
    };
    s.anim = requestAnimationFrame(step);
  }, [focusKey, selectedId, trips, reduce]);

  const selected = trips.find((t) => t.id === selectedId && t.atlasLocation);
  const same = selected ? trips.filter((t) => t.atlasLocation && selected.atlasLocation && t.atlasLocation.latitude.toFixed(2) === selected.atlasLocation.latitude.toFixed(2) && t.atlasLocation.longitude.toFixed(2) === selected.atlasLocation.longitude.toFixed(2)) : [];

  const zoomBy = (f: number) => {
    const s = state.current;
    s.intro = false;
    s.lastAct = performance.now();
    s.zoom = Math.max(0.8, Math.min(4, s.zoom * f));
    drawRef.current();
  };

  return (
    <section className="globe-col" aria-label="Globe" ref={wrap}>
      {failed ? (
        <div className="globe-fallback">
          <b>The globe can&apos;t load here</b>
          <p className="note">Your trips are all in the list.</p>
        </div>
      ) : (
        <>
          <div className="globe-stage" ref={stage} aria-hidden="true" />
          <canvas ref={canvas} tabIndex={0} role="img" aria-label="Globe with one marker per located trip. Drag to turn, scroll to zoom, or use the arrow keys and plus and minus. The trip list shows every trip." />
          <span className="globe-hint mono" data-gone={hintGone}>Drag to turn<br />Scroll to zoom</span>
          <div className="legend mono" aria-label="Marker key">
            <span><i className="mk mk-upcoming" />Upcoming</span>
            <span><i className="mk mk-ongoing" />Ongoing</span>
            <span><i className="mk mk-past" />Past</span>
          </div>
          <div className="globe-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><PlusIcon /></button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><MinusIcon /></button>
            <button type="button" aria-label="Reset view" onClick={() => { state.current.rot = [...HOME]; zoomBy(1 / state.current.zoom); }}><ResetIcon /></button>
          </div>
          {selected ? (
            <div className="callout" ref={callout}>
              {same.length > 1 ? (
                <>
                  <div className="mono muted">{same.length} trips share this point</div>
                  <div className="callout-list">
                    {same.map((o) => (
                      <button key={o.id} type="button" aria-current={o.id === selected.id} onClick={() => onSelect(o.id, true)}>
                        <b>{o.title}</b>
                        <small>{dateRangeLabel(o)}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <h3>{selected.title}</h3>
              <div className="mono muted">{dateRangeLabel(selected)}</div>
              <div className="callout-actions">
                <span className={`tag tag-${selected.status}`}><StatusIcon status={selected.status} />{STATUS_LABEL[selected.status]}</span>
                <a className="pill pill-fill" href={`/trips/${selected.id}`} data-trip-link={selected.id}>Open trip</a>
              </div>
              <div className="muted">{selected.atlasLocation?.source === "owner" ? "Point set by you" : "Approximate destination"}</div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
