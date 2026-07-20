"use client";

import { memo } from "react";
import type { BlockInstance } from "@/features/workspace/types";
import { DEV_MODE } from "@/config/devMode";
import { getBlockDefinition } from "@/features/workspace/blocks/registry";
import { BlockRenderer } from "@/features/workspace/blocks/BlockRenderer";
import { BlockErrorBoundary } from "@/features/workspace/blocks/BlockErrorBoundary";
import { BlockShell } from "@/features/workspace/blocks/shared/BlockShell";

/**
 * Chooses how a block is presented:
 * - DEV_MODE + interactive block → `BlockShell` (select / move / resize / toolbar).
 * - otherwise (student build, or present-only blocks like the lesson board) →
 *   a transparent, pan-through wrapper with the content and zero authoring chrome.
 * Memoized so a pan never re-renders an unchanged block.
 */
function BlockFrameImpl({ block, regionId, selected }: { block: BlockInstance; regionId: string; selected: boolean }) {
  const def = getBlockDefinition(block.type);

  if (DEV_MODE && def?.interactive) {
    return <BlockShell block={block} regionId={regionId} selected={selected} />;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: block.position.x,
        top: block.position.y,
        width: block.size.w,
        height: block.size.h,
        pointerEvents: "none",
      }}
    >
      <BlockErrorBoundary label={`${block.type}:${block.id}`}>
        <BlockRenderer block={block} regionId={regionId} selected={false} editing={false} />
      </BlockErrorBoundary>
    </div>
  );
}

export const BlockFrame = memo(BlockFrameImpl);
