"use client";

import { memo } from "react";
import type { BlockInstance, Region } from "@/features/workspace/types";
import { z as zTokens } from "@/config/tokens";
import { BlockFrame } from "@/features/workspace/blocks/BlockFrame";

interface RegionFrameProps {
  region: Region;
  /** Pre-culled blocks from the virtualizer (may be fewer than region.blocks). */
  visibleBlocks: BlockInstance[];
  selectedIds: string[];
}

/**
 * One explanation area in world space — a transparent, boundary-less wrapper.
 * No card: no border, background, shadow, or header. Content sits directly on the
 * infinite canvas. The wrapper is pointer-transparent so dragging empty canvas
 * pans; interactive blocks (dev) opt back into pointer events via `BlockShell`.
 */
function RegionFrameImpl({ region, visibleBlocks, selectedIds }: RegionFrameProps) {
  return (
    <section
      aria-label={`Explanation: ${region.title}`}
      style={{
        position: "absolute",
        left: region.position.x,
        top: region.position.y,
        width: region.size.w,
        height: region.size.h,
        pointerEvents: "none",
        zIndex: zTokens.block,
      }}
    >
      {visibleBlocks.map((b) => (
        <BlockFrame key={b.id} block={b} regionId={region.id} selected={selectedIds.includes(b.id)} />
      ))}
    </section>
  );
}

export const RegionFrame = memo(RegionFrameImpl);
