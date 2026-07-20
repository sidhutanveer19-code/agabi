"use client";

import { color, radius } from "@/config/tokens";
import type { BlockInstance } from "@/features/workspace/types";
import { getBlockDefinition } from "./registry";
import { BlockErrorBoundary } from "./BlockErrorBoundary";

/** Resolves a block instance to its registered renderer (guarded). */
export function BlockRenderer({ block }: { block: BlockInstance }) {
  const def = getBlockDefinition(block.type);
  if (!def) {
    return (
      <div
        style={{
          padding: 14,
          border: `1px dashed ${color.border}`,
          borderRadius: radius.md,
          color: color.muted,
          fontSize: 13,
        }}
      >
        Unregistered block: {block.type}
      </div>
    );
  }
  const Renderer = def.Renderer;
  return (
    <BlockErrorBoundary>
      <Renderer block={block} data={block.data} />
    </BlockErrorBoundary>
  );
}
