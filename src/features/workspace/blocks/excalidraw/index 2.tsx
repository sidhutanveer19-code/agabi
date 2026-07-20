"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { PenTool } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { ExcalidrawData } from "@/features/workspace/blocks/excalidraw/ExcalidrawRenderer";

const ExcalidrawRenderer = dynamic(() => import("@/features/workspace/blocks/excalidraw/ExcalidrawRenderer"), {
  ssr: false,
  loading: () => <BlockLoading label="sketch…" />,
});

const schema = z.object({ elements: z.array(z.any()) }) as z.ZodType<ExcalidrawData>;

function ExcalidrawBlock(props: BlockRendererProps<ExcalidrawData>) {
  return <ExcalidrawRenderer {...props} />;
}

export function registerExcalidrawBlock(): void {
  if (hasBlock("excalidraw")) return;
  const def: BlockDefinition<ExcalidrawData> = {
    type: "excalidraw",
    label: "Sketch",
    category: "diagram",
    icon: PenTool,
    version: 1,
    component: ExcalidrawBlock,
    schema,
    create: () => ({ elements: [] }),
    defaultSize: { w: 600, h: 420 },
    interactive: true,
    resizable: true,
    keywords: ["excalidraw", "sketch", "draw", "whiteboard", "handdrawn"],
  };
  registerBlock(def);
}
