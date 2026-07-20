"use client";

import { useMemo } from "react";
import type { BlockInstance, Camera, Rect, Region, Size } from "@/features/workspace/types";
import { visibleWorldRect } from "@/features/workspace/camera/cameraMath";
import { inflateRect, rectIntersects } from "@/features/workspace/utils/geometry";

export interface VisibleRegion {
  region: Region;
  blocks: BlockInstance[];
}

/**
 * Cull to only the regions (and, within them, only the blocks) intersecting the
 * visible world rect + a margin. This keeps thousands of blocks / hundreds of
 * regions smooth: off-screen content is never rendered.
 *
 * Region scan is O(n) — fine for hundreds. A spatial grid index is the drop-in
 * upgrade point here if region counts ever reach many thousands.
 */
export function useVirtualizedRegions(
  regions: Region[],
  camera: Camera,
  viewport: Size,
  margin = 400
): VisibleRegion[] {
  return useMemo(() => {
    if (viewport.w === 0 || viewport.h === 0) return [];
    const view = inflateRect(visibleWorldRect(camera, viewport), margin / camera.scale);
    const result: VisibleRegion[] = [];
    for (const region of regions) {
      const regionRect: Rect = {
        x: region.position.x,
        y: region.position.y,
        w: region.size.w,
        h: region.size.h,
      };
      if (!rectIntersects(regionRect, view)) continue;
      const blocks = region.blocks.filter((b) => {
        const blockRect: Rect = {
          x: region.position.x + b.position.x,
          y: region.position.y + b.position.y,
          w: b.size.w,
          h: b.size.h,
        };
        return rectIntersects(blockRect, view);
      });
      result.push({ region, blocks });
    }
    return result;
  }, [regions, camera, viewport, margin]);
}
