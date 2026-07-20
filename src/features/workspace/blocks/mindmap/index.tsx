"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Waypoints } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MindmapData } from "@/features/workspace/blocks/mindmap/Renderer";

// Heavy library (markmap-lib + markmap-view) — code-split, loaded only when a
// mindmap block mounts.
const MindmapRenderer = dynamic(() => import("@/features/workspace/blocks/mindmap/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="mind map…" />,
});

const schema = z.object({ markdown: z.string() }) as z.ZodType<MindmapData>;

function MindmapBlock(props: BlockRendererProps<MindmapData>) {
  return <MindmapRenderer {...props} />;
}

export function registerMindmapBlock(): void {
  if (hasBlock("mindmap")) return;
  const def: BlockDefinition<MindmapData> = {
    type: "mindmap",
    label: "Mind Map",
    category: "diagram",
    icon: Waypoints,
    version: 1,
    component: MindmapBlock,
    schema,
    create: () => ({
      markdown: "# Topic\n## A\n## B\n",
    }),
    defaultSize: { w: 520, h: 380 },
    interactive: true,
    resizable: true,
    keywords: ["mindmap", "mind map", "markmap", "outline", "brainstorm", "tree", "concept"],
  };
  registerBlock(def);
}
