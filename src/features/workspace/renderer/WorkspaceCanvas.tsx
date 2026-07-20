"use client";

import { type RefObject } from "react";
import type { Size } from "@/features/workspace/types";
import { color, z as zTokens } from "@/config/tokens";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { useVirtualizedRegions } from "@/features/workspace/virtualization/useVirtualizedRegions";
import { RegionFrame } from "@/features/workspace/regions/RegionFrame";

const GRID_BASE = 40;

/**
 * The infinite canvas surface. Layers (bottom→top): dotted grid (pan target) →
 * a single `translate()scale()` transform layer (pan = one GPU transform, block
 * content never re-renders) → virtualized-visible regions in world space.
 */
export function WorkspaceCanvas({
  containerRef,
  viewport,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  viewport: Size;
}) {
  const camera = useCameraStore((s) => s.camera);
  const regions = useWorkspaceStore((s) => s.doc.regions);
  const selectedIds = useUiStore((s) => s.selectedIds);

  const visible = useVirtualizedRegions(regions, camera, viewport);
  const gridSize = Math.max(6, GRID_BASE * camera.scale);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Learning workspace — infinite canvas. Drag to pan, pinch or ⌘-scroll to zoom, press 0 to fit."
      tabIndex={0}
      style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", outline: "none", background: color.bg, cursor: "grab" }}
    >
      <div
        data-ws-bg="1"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: zTokens.canvas,
          backgroundImage: `radial-gradient(circle, ${color.border} 1px, transparent 1px)`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          pointerEvents: "none",
          zIndex: zTokens.block,
        }}
      >
        {visible.map(({ region, visibleBlocks }) => (
          <RegionFrame key={region.id} region={region} visibleBlocks={visibleBlocks} selectedIds={selectedIds} />
        ))}
      </div>
    </div>
  );
}
