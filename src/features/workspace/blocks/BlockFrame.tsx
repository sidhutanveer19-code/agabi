"use client";

import { memo } from "react";
import { color, radius } from "@/config/tokens";
import type { BlockInstance } from "@/features/workspace/types";
import { BlockRenderer } from "./BlockRenderer";

interface BlockFrameProps {
  block: BlockInstance;
  selected: boolean;
  onSelect: () => void;
}

/** Positions a hosted block within its region and handles selection + a11y. */
export const BlockFrame = memo(function BlockFrame({ block, selected, onSelect }: BlockFrameProps) {
  return (
    <div
      role="group"
      aria-label={`${block.type} block`}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      className="ds-focus"
      style={{
        position: "absolute",
        left: block.position.x,
        top: block.position.y,
        width: block.size.w,
        minHeight: block.size.h,
        zIndex: block.z,
        borderRadius: radius.lg,
        outline: selected ? `2px solid ${color.violet2}` : undefined,
        outlineOffset: 3,
      }}
    >
      <BlockRenderer block={block} />
    </div>
  );
});
