"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Brush } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { TldrawData } from "@/features/workspace/blocks/tldraw/TldrawRenderer";

const TldrawRenderer = dynamic(() => import("@/features/workspace/blocks/tldraw/TldrawRenderer"), {
  ssr: false,
  loading: () => <BlockLoading label="board…" />,
});

const schema = z.object({ snapshot: z.any().nullable() }) as z.ZodType<TldrawData>;

function TldrawBlock(props: BlockRendererProps<TldrawData>) {
  return <TldrawRenderer {...props} />;
}

export function registerTldrawBlock(): void {
  if (hasBlock("tldraw")) return;
  const def: BlockDefinition<TldrawData> = {
    type: "tldraw",
    label: "Draw Board",
    category: "diagram",
    icon: Brush,
    version: 1,
    component: TldrawBlock,
    schema,
    create: () => ({ snapshot: null }),
    defaultSize: { w: 620, h: 440 },
    interactive: true,
    resizable: true,
    keywords: ["tldraw", "draw", "board", "whiteboard", "canvas"],
  };
  registerBlock(def);
}
