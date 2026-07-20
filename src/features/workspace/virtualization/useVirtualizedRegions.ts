"use client";

import { useMemo } from "react";
import type { BlockInstance, Camera, Region, Size } from "@/features/workspace/types";
import { visibleWorldRect } from "@/features/workspace/camera/cameraMath";
import { inflateRect, rectIntersects } from "@/features/workspace/utils/geometry";

export interface VisibleRegion {
  region: Region;
  /** Only the blocks that intersect the viewport (region-local → world tested). */
  visibleBlocks: BlockInstance[];
}

/**
 * Viewport-based rendering: return only the regions (and, per region, only the
 * blocks) that intersect the visible world rectangle plus a pre-render margin.
 *
 * This is the core scale strategy — thousands of blocks across hundreds of
 * regions stay cheap because off-screen work is never mounted. Panning changes
 * `camera`, which recomputes the visible set; block *content* is untouched.
 *
 * Complexity is O(regions + visibleBlocks). A grid spatial index can replace the
 * linear region scan here if region counts ever reach tens of thousands.
 */
export function useVirtualizedRegions(
  regions: Region[],
  camera: Camera,
  viewport: Size,
  margin = 300
): VisibleRegion[] {
  return useMemo(() => {
    if (viewport.w === 0 || viewport.h === 0) return [];
    const view = inflateRect(visibleWorldRect(camera, viewport), margin);

    const out: VisibleRegion[] = [];
    for (const region of regions) {
      const rRect = { x: region.position.x, y: region.position.y, w: region.size.w, h: region.size.h };
      if (!rectIntersects(view, rRect)) continue;

      const visibleBlocks = region.blocks.filter((b) => {
        const worldRect = {
          x: region.position.x + b.position.x,
          y: region.position.y + b.position.y,
          w: b.size.w,
          h: b.size.h,
        };
        return rectIntersects(view, worldRect);
      });
      out.push({ region, visibleBlocks });
    }
    return out;
  }, [regions, camera, viewport, margin]);
}
