"use client";

import { Suspense } from "react";
import { color, radius } from "@/design-system/tokens";
import { Skeleton } from "@/design-system/primitives/atoms";
import { getBlock } from "./registry";
import { BlockErrorBoundary } from "./BlockErrorBoundary";
import type { BlockInstance } from "./types";

/** Resolves a block instance to its registered renderer (lazy + guarded). */
export function BlockRenderer({ block }: { block: BlockInstance }) {
  const def = getBlock(block.type);

  if (!def) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px dashed ${color.border}`,
          borderRadius: radius.md,
          color: color.muted,
          fontSize: 13,
        }}
      >
        Unknown block: {block.type}
      </div>
    );
  }

  const Renderer = def.Renderer;
  return (
    <BlockErrorBoundary label={def.label}>
      <Suspense fallback={<Skeleton h={90} />}>
        <Renderer data={block.data} block={block} />
      </Suspense>
    </BlockErrorBoundary>
  );
}
