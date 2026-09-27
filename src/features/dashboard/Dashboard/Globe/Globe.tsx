"use client";

import { useEffect, useRef, useState } from "react";
import { geoOrthographic, geoPath } from "d3-geo";
import type { TripSummaryDTO } from "@/shared/dto";
import { cx } from "@/lib/cx";
import { drawGlobe, groupsOf, type GlobeView, type Pin } from "./drawGlobe";
import { GlobeCallout } from "./GlobeCallout/GlobeCallout";
import { GlobeControls } from "./GlobeControls/GlobeControls";
import styles from "./Globe.module.css";

const HOME: [number, number] = [-96, -26]; // rotation that centers Asia

type Props = {
  trips: TripSummaryDTO[];
  selectedId: string | null;
  focusKey: number;
  onSelect: (id: string | null, fromGlobe: boolean) => void;
  /** Placement from the page layout. */
  className?: string;
};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Dashboard globe (ATLAS-1, ATLAS-6): bundled Natural Earth land on a canvas, one marker per
 * located trip, status by shape. The trip list is the complete alternative.
 */
export function Globe({ trips, selectedId, focusKey, onSelect, className }: Props) {
  const wrap = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const callout = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const state = useRef<GlobeView & { lastAct: number; anim: number; intro: boolean }>({ rot: [HOME[0] + 90, HOME[1] + 14], zoom: 0.8, w: 0, h: 0, sx: 0, sy: 0, sw: 0, sh: 0, dpr: 1, pulse: 0, lastAct: 0, anim: 0, intro: true });
  const data = useRef({ trips, selectedId, groups: groupsOf(trips) });
  const pins = useRef<Pin[]>([]);
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
      // The globe is centred in the stage; beyond it (under the trip list on desktop) it may
      // spill when zoomed, drawn faintly behind the list.
      const st = stage.current?.getBoundingClientRect();
      s.sx = st ? st.left - r.left : 0;
      s.sy = st ? st.top - r.top : 0;
      s.sw = st?.width || r.width;
      s.sh = st?.height || r.height;
    }

    function draw() {
      const out = drawGlobe(ctx!, projection, path, s, data.current.groups, data.current.selectedId, colors, reduce);
      pins.current = out;
      // Keep the callout next to the selected marker, inside the stage.
      const c = callout.current;
      const selPin = out.find((p) => p.g.trips.some((t) => t.id === data.current.selectedId));
      if (!c) return;
      if (!selPin) {
        c.style.visibility = "hidden";
        return;
      }
      c.style.visibility = "visible";
      const pw = c.offsetWidth;
      const ph = c.offsetHeight;
      let x = selPin.x + 24;
      if (x + pw > s.w - 8) x = selPin.x - pw - 24;
      c.style.left = `${Math.max(s.sx + 8, Math.min(s.w - pw - 8, x))}px`;
      c.style.top = `${Math.max(8, Math.min(s.h - ph - 8, selPin.y - ph / 2))}px`;
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

  const zoomBy = (f: number) => {
    const s = state.current;
    s.intro = false;
    s.lastAct = performance.now();
    s.zoom = Math.max(0.8, Math.min(4, s.zoom * f));
    drawRef.current();
  };

  return (
    <section className={cx(styles.globe, className)} aria-label="Globe" ref={wrap}>
      {failed ? (
        <div className={styles.fallback}>
          <b>The globe can&apos;t load here</b>
          <p className="note">Your trips are all in the list.</p>
        </div>
      ) : (
        <>
          <div className={styles.stage} ref={stage} aria-hidden="true" />
          <canvas ref={canvas} className={styles.canvas} tabIndex={0} role="img" aria-label="Globe with one marker per located trip. Drag to turn, scroll to zoom, or use the arrow keys and plus and minus. The trip list shows every trip." />
          <GlobeControls
            hintGone={hintGone}
            onZoomIn={() => zoomBy(1.25)}
            onZoomOut={() => zoomBy(0.8)}
            onReset={() => {
              state.current.rot = [...HOME];
              zoomBy(1 / state.current.zoom);
            }}
          />
          {selected ? <GlobeCallout ref={callout} selected={selected} trips={trips} onSelect={(id) => onSelect(id, true)} /> : null}
        </>
      )}
    </section>
  );
}
