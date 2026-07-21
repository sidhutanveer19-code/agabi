"use client";

import dynamic from "next/dynamic";
import type { BlockDefinition } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import { PRESETS, mathSchema, type MathData } from "@/features/workspace/blocks/math/presets";

// Heavy library (KaTeX + CSS) — code-split, loaded only when a math block mounts.
const Renderer = dynamic(() => import("@/features/workspace/blocks/math/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="math…" />,
});

export function registerMathBlocks(): void {
  for (const p of PRESETS) {
    if (hasBlock(p.type)) continue;
    const def: BlockDefinition<MathData> = {
      type: p.type,
      label: p.label,
      category: "math",
      icon: p.icon,
      version: 1,
      component: Renderer,
      schema: mathSchema,
      create: () => ({ latex: p.sample }),
      defaultSize: p.defaultSize,
      interactive: true,
      resizable: true,
      keywords: [p.label.toLowerCase(), "math", "latex", "katex"],
    };
    registerBlock(def);
  }
}
