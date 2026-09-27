"use client";

import { useEffect, useRef, useState } from "react";
import { haversineKm } from "@/shared/map-links";
import { cx as cn } from "@/lib/cx";
import type { Stop } from "../../trip-days";
import { km, StopList } from "./StopList/StopList";
import styles from "./DayMap.module.css";


const W0 = 400;
const H0 = 340;
const PAD = 56;
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);


/**
 * Schematic day map (MAP-3 to MAP-5): no basemap and no network requests. Pins use a
 * local equirectangular fit; lines join consecutive non-flight stops of the same day.
 */
export function DayMap({ stops, showDays, onPin }: { stops: Stop[]; showDays: boolean; onPin: (id: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: W0, h: H0 });
  const [screenW, setScreenW] = useState(0);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; id: number; moved: boolean } | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; w: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScreenW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stops.length]);

  // Projection with longitudes unwrapped around the median stop (antimeridian-safe).
  const lat0 = stops.reduce((a, s) => a + s.lat, 0) / (stops.length || 1);
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const lons = stops.map((s) => s.lon).sort((a, b) => a - b);
  const med = lons[Math.floor(lons.length / 2)] ?? 0;
  const xs = stops.map((s) => (s.lon - med > 180 ? s.lon - 360 : s.lon - med < -180 ? s.lon + 360 : s.lon) * kx);
  const ys = stops.map((s) => -s.lat);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const spx = Math.max(maxx - minx, 0.02 * kx);
  const spy = Math.max(maxy - miny, 0.02);
  const sc = Math.min((W0 - 2 * PAD - 40) / spx, (H0 - 2 * PAD) / spy);
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  const pts = stops.map((s, i) => ({ s, x: W0 / 2 + (xs[i]! - cx) * sc, y: H0 / 2 + (ys[i]! - cy) * sc }));
  const pr = stops.length > 5 ? 11 : 14;
  const z = W0 / vb.w;
  const k = screenW ? screenW / W0 : 1;

  // Merge pins closer than 14 screen pixels; hide labels that collide.
  const screen = pts.map((p) => ({ x: ((p.x - vb.x) / vb.w) * (screenW || W0), y: ((p.y - vb.y) / vb.h) * ((screenW || W0) * (H0 / W0)) }));
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
      const group = [i, ...(members.get(i) ?? [])].map((g) => pts[g]!.s.n);
      const joined = group.join("·");
      const text = group.length > 1 ? (joined.length <= 5 ? joined : `${group[0]}+`) : String(group[0]);
      const r = group.length > 1 ? pr + (text.length > 2 ? 7 : 3) : pr;
      const label = group.length > 1 ? `Stops ${group.join(", ")}` : short(p.s.name);
      return { p, i, group, text, r, label, right: p.x < W0 * 0.62 };
    });
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
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

  // Scale bar: largest round distance under ~90 px.
  const mpx = ((111320 / sc) * vb.w) / (screenW || W0);
  let pick = NICE[0]!;
  for (const n of NICE) if (n / mpx <= 90) pick = n;

  function clampVb(v: typeof vb) {
    return { ...v, x: Math.max(-W0 * 0.5, Math.min(W0 * 1.5 - v.w, v.x)), y: Math.max(-H0 * 0.5, Math.min(H0 * 1.5 - v.h, v.y)) };
  }
  function zoomTo(ux: number, uy: number, nw: number): boolean {
    const cur = vb;
    const w = Math.max(W0 / 12, Math.min(W0, nw));
    if (Math.abs(w - cur.w) < 0.01) return false;
    const h = (w * H0) / W0;
    setVb(clampVb({ x: ux - ((ux - cur.x) * w) / cur.w, y: uy - ((uy - cur.y) * h) / cur.h, w, h }));
    return true;
  }
  function toUser(clientX: number, clientY: number): [number, number] {
    const r = svg.current!.getBoundingClientRect();
    const cur = vb;
    return [cur.x + ((clientX - r.left) / r.width) * cur.w, cur.y + ((clientY - r.top) / r.height) * cur.h];
  }

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
      setVb(clampVb({ ...cur, x: d.vx - (dx / r.width) * cur.w, y: d.vy - (dy / r.height) * cur.h }));
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
        <b>No places pinned yet</b>
        <span>Edit an event and add a Google Maps, Apple Maps or OpenStreetMap link with coordinates, and it will show up here.</span>
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

  const legs = stops.map((s, i) => {
    const prev = stops[i - 1];
    const same = !!prev && prev.day === s.day && !prev.flight && !s.flight;
    const d = same ? haversineKm([prev!.lat, prev!.lon], [s.lat, s.lon]) : 0;
    return { s, same, d, chip: showDays && (!prev || prev.day !== s.day) };
  });
  const total = legs.reduce((a, l) => a + l.d, 0);

  return (
    <>
      <div className={styles.wrap}>
        <svg
          ref={svg}
          className={styles.map}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          role="group"
          aria-label="Sketch map of the stops, in order. Use the plus and minus buttons, the mouse wheel or a pinch to zoom, and drag to move."
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
          <rect x={-2000} y={-2000} width={4400} height={4340} fill="url(#map-grid)" />
          {runs.map((r, i) => (
            <polyline key={i} className={styles.route} points={r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
          ))}
          {shown.map((d, ix) => (
            <g
              key={d.p.s.id}
              className={styles.pin}
              data-hl={d.p.s.id}
              transform={`translate(${d.p.x.toFixed(1)} ${d.p.y.toFixed(1)}) scale(${1 / z})`}
              tabIndex={0}
              role="button"
              aria-label={d.group.length > 1 ? `Stops ${d.group.join(", ")}, at nearly the same place` : `Stop ${d.p.s.n}: ${d.p.s.name}`}
              onClick={() => onPin(d.p.s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPin(d.p.s.id);
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
        <div className={styles.controls}>
          <span className={styles.zoom}>
            <button type="button" aria-label="Zoom in on the map" disabled={z > 11.9} onClick={() => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, vb.w / 1.5)}>+</button>
            <button type="button" aria-label="Zoom out on the map" disabled={z < 1.02} onClick={() => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, vb.w * 1.5)}>−</button>
          </span>
          <span className={styles.scale}>
            <i style={{ width: Math.max(8, pick / mpx) }} />
            <span className="mono">{pick >= 1000 ? `${pick / 1000} km` : `${pick} m`}</span>
          </span>
          <svg className={styles.north} viewBox="0 0 22 40" aria-hidden="true">
            <path d="M11 30V6M5 13l6-8 6 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="11" y="40" textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="currentColor">N</text>
          </svg>
          {z > 1.02 ? (
            <button className={cn("mono", styles.reset)} type="button" onClick={() => setVb({ x: 0, y: 0, w: W0, h: H0 })}>Reset view</button>
          ) : null}
        </div>
      </div>
      <StopList legs={legs} />
      {total > 0 ? <p className="note">About {km(total)} in straight lines between stops on the same day. Flights are not counted.</p> : null}
    </>
  );
}
