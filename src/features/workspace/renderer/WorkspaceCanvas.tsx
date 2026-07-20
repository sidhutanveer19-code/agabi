"use client";

import { useCallback, type RefObject } from "react";
import { color } from "@/config/tokens";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useSelectionStore } from "@/features/workspace/stores/selection.store";
import { useVirtualizedRegions } from "@/features/workspace/virtualization/useVirtualizedRegions";
import { usePanZoom } from "@/features/workspace/interaction/usePanZoom";
import { RegionFrame } from "@/features/workspace/regions/RegionFrame";
import type { Size } from "@/features/workspace/types";

/**
 * The infinite canvas surface. Agabi owns it: one transformed world layer holds
 * every region; only visible regions/blocks render (virtualization); continuous
 * pan is a GPU transform (block content never re-renders).
 */
export function WorkspaceCanvas({
  containerRef,
  size,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  size: Size;
}) {
  const camera = useCameraStore((s) => s.camera);
  const regions = useWorkspaceStore((s) => s.doc.regions);
  const selectedRegionId = useSelectionStore((s) => s.selectedRegionId);
  const selectedBlockId = useSelectionStore((s) => s.selectedBlockId);
  const selectRegion = useSelectionStore((s) => s.selectRegion);
  const selectBlock = useSelectionStore((s) => s.selectBlock);

  usePanZoom(containerRef);

  const visible = useVirtualizedRegions(regions, camera, size);

  const onSelectBlock = useCallback(
    (regionId: string, blockId: string) => selectBlock(regionId, blockId),
    [selectBlock]
  );

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Infinite learning workspace. Drag to pan, control plus scroll to zoom, arrow keys to move, press 0 to fit."
      tabIndex={0}
      className="ds-focus"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        cursor: "grab",
        backgroundColor: color.bg,
        backgroundImage: "radial-gradient(rgba(255,255,255,.028) 1px,transparent 1px)",
        backgroundSize: `${28 * camera.scale}px ${28 * camera.scale}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
    >
      {/* background pan target (transform layer above is pointer-transparent) */}
      <div data-ws-bg="1" style={{ position: "absolute", inset: 0 }} />

      {/* transformed world layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        {visible.map(({ region, blocks }) => (
          <div key={region.id} style={{ pointerEvents: "auto" }}>
            <RegionFrame
              region={region}
              blocks={blocks}
              selected={selectedRegionId === region.id}
              selectedBlockId={selectedBlockId}
              onSelectRegion={() => selectRegion(region.id)}
              onSelectBlock={(blockId) => onSelectBlock(region.id, blockId)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
