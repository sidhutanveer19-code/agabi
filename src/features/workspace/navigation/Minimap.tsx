"use client";

import { useMemo } from "react";
import { color, radius } from "@/config/tokens";
import type { Camera, Region, Size } from "@/features/workspace/types";
import { visibleWorldRect } from "@/features/workspace/camera/cameraMath";
import { unionRects } from "@/features/workspace/utils/geometry";

const MW = 190;
const MH = 130;
const PAD = 8;

/** Overview of the whole workspace + current viewport; click a region to fly to it. */
export function Minimap({
  regions,
  camera,
  viewport,
  onGoTo,
}: {
  regions: Region[];
  camera: Camera;
  viewport: Size;
  onGoTo: (region: Region) => void;
}) {
  const world = useMemo(
    () => unionRects(regions.map((r) => ({ x: r.position.x, y: r.position.y, w: r.size.w, h: r.size.h }))),
    [regions]
  );
  if (!world || regions.length === 0 || viewport.w === 0) return null;

  const scale = Math.min((MW - PAD * 2) / world.w, (MH - PAD * 2) / world.h);
  const toMap = (x: number, y: number) => ({
    x: PAD + (x - world.x) * scale,
    y: PAD + (y - world.y) * scale,
  });
  const view = visibleWorldRect(camera, viewport);
  const vp = toMap(view.x, view.y);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        width: MW,
        height: MH,
        borderRadius: radius.md,
        border: `1px solid ${color.border}`,
        background: "rgba(10,12,17,0.82)",
        overflow: "hidden",
      }}
    >
      {regions.map((r) => {
        const p = toMap(r.position.x, r.position.y);
        return (
          <button
            key={r.id}
            type="button"
            title={r.title}
            onClick={() => onGoTo(r)}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: Math.max(2, r.size.w * scale),
              height: Math.max(2, r.size.h * scale),
              borderRadius: 2,
              border: `1px solid ${r.accent ?? color.violet2}`,
              background: "rgba(167,139,250,0.15)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: vp.x,
          top: vp.y,
          width: Math.max(2, view.w * scale),
          height: Math.max(2, view.h * scale),
          border: `1px solid ${color.cyan}`,
          background: "rgba(56,189,248,0.08)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
