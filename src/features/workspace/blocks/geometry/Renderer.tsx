"use client";

import { useEffect, useRef } from "react";
import JXG from "jsxgraph";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";

export interface GeometryPoint {
  id: string;
  x: number;
  y: number;
  name?: string;
}

export interface GeometryData {
  points: GeometryPoint[];
  segments: [string, string][];
}

const EMPTY: GeometryData = { points: [], segments: [] };

/** Snap float drift from dragging back to a stable, serializable number. */
function tidy(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * Structural fingerprint — rebuild the board only when topology changes
 * (points added/removed/renamed, segments, edit mode). Pure coordinate
 * changes from dragging are persisted to `data` but drawn natively by
 * JSXGraph, so they must NOT trigger a rebuild (that would fight the drag).
 */
function topology(data: GeometryData, editing: boolean): string {
  const pts = data.points.map((p) => `${p.id}:${p.name ?? ""}`).join(",");
  const segs = data.segments.map((s) => `${s[0]}-${s[1]}`).join(",");
  return `${editing ? "e" : "p"}|${pts}|${segs}`;
}

/** Bounding box [left, top, right, bottom] padded around the current points. */
function boundingBox(points: GeometryPoint[]): [number, number, number, number] {
  if (points.length === 0) return [-5, 5, 5, -5];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 2;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 2);
  const spanY = Math.max(maxY - minY, 2);
  return [minX - pad, maxY + pad, minX + spanX + pad, maxY - spanY - pad];
}

/**
 * JSXGraph geometry board (lazy-loaded). Draggable points + segments in dev
 * (editing), locked presentation view otherwise. All state lives in `data`.
 */
export default function GeometryRenderer({ block, editing, onChange }: BlockRendererProps<GeometryData>) {
  const data = block.data ?? EMPTY;
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Latest data + onChange, read inside JSXGraph event handlers without
  // re-subscribing (avoids stale closures and rebuild churn).
  const dataRef = useRef<GeometryData>(data);
  const onChangeRef = useRef<typeof onChange>(onChange);
  useEffect(() => {
    dataRef.current = data;
    onChangeRef.current = onChange;
  });

  const sig = topology(data, !!editing);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const snapshot = dataRef.current;

    const board = JXG.JSXGraph.initBoard(el, {
      boundingbox: boundingBox(snapshot.points),
      keepaspectratio: true,
      axis: true,
      grid: true,
      showCopyright: false,
      showNavigation: false,
      showInfobox: false,
      pan: { enabled: false, needShift: false },
      zoom: { wheel: false, needShift: true },
    });

    const pointObjs = new Map<string, JXG.Point>();
    for (const p of snapshot.points) {
      const pt = board.create("point", [p.x, p.y], {
        name: p.name ?? "",
        withLabel: Boolean(p.name),
        size: 4,
        fillColor: color.violet2,
        strokeColor: color.violet,
        highlightFillColor: color.violet3,
        highlightStrokeColor: color.violet3,
        fixed: !editing,
        showInfobox: false,
        label: { strokeColor: color.ink, fontSize: 13 },
      });
      pointObjs.set(p.id, pt);
    }

    for (const [a, b] of snapshot.segments) {
      const pa = pointObjs.get(a);
      const pb = pointObjs.get(b);
      if (!pa || !pb) continue;
      board.create("segment", [pa, pb], {
        strokeColor: color.cyan,
        strokeWidth: 2,
        highlightStrokeColor: color.cyan2,
        fixed: true,
        layer: 5,
      });
    }

    // Persist dragged coordinates back into `data` (edit mode only).
    if (editing) {
      const persist = () => {
        const current = dataRef.current;
        const nextPoints = current.points.map((p) => {
          const obj = pointObjs.get(p.id);
          if (!obj) return p;
          return { ...p, x: tidy(obj.X()), y: tidy(obj.Y()) };
        });
        onChangeRef.current?.({ points: nextPoints, segments: current.segments });
      };
      pointObjs.forEach((obj) => {
        obj.on("up", persist);
        obj.on("drag", persist);
      });
    }

    return () => {
      JXG.JSXGraph.freeBoard(board);
    };
    // Rebuild only on topology/edit-mode change — see topology().
  }, [sig, editing]);

  return (
    <div
      role={editing ? "application" : "img"}
      aria-label={`Interactive geometry board with ${data.points.length} points and ${data.segments.length} segments`}
      onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
        fontFamily: font.sans,
      }}
    >
      <div ref={boxRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />
    </div>
  );
}
