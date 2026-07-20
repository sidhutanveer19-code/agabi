"use client";

import { Suspense } from "react";
import type { BlockInstance } from "@/features/workspace/types";
import { getBlockDefinition } from "@/features/workspace/blocks/registry";
import { semantic } from "@/config/tokens";

/**
 * Resolve a block instance to its registered component and render it. The
 * renderer is ignorant of educational meaning — a registry lookup only.
 * `Suspense` lets future block components be `React.lazy` / dynamically imported.
 * An unrecognized type renders NOTHING (never debug text).
 */
export function BlockRenderer({
  block,
  regionId,
  selected,
  editing,
  onChange,
}: {
  block: BlockInstance;
  regionId: string;
  selected: boolean;
  editing?: boolean;
  onChange?: (data: unknown) => void;
}) {
  const def = getBlockDefinition(block.type);
  if (!def) return null;

  const Component = def.component;
  return (
    <Suspense fallback={<div style={{ width: "100%", height: "100%", background: semantic.skeleton }} />}>
      <Component block={block} regionId={regionId} selected={selected} editing={editing} onChange={onChange} />
    </Suspense>
  );
}
