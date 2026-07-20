"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Share2 } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { FlowData } from "@/features/workspace/blocks/flow/FlowRenderer";

// Heavy library — code-split, loaded only when a flow block mounts.
const FlowRenderer = dynamic(() => import("@/features/workspace/blocks/flow/FlowRenderer"), {
  ssr: false,
  loading: () => <BlockLoading label="flowchart…" />,
});

const schema = z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }) as z.ZodType<FlowData>;

function FlowBlock(props: BlockRendererProps<FlowData>) {
  return <FlowRenderer {...props} />;
}

export function registerFlowBlock(): void {
  if (hasBlock("flow")) return;
  const def: BlockDefinition<FlowData> = {
    type: "flow",
    label: "Flowchart",
    category: "diagram",
    icon: Share2,
    version: 1,
    component: FlowBlock,
    schema,
    create: () => ({
      nodes: [
        { id: "1", position: { x: 40, y: 40 }, data: { label: "Start" } },
        { id: "2", position: { x: 220, y: 150 }, data: { label: "Next" } },
      ],
      edges: [{ id: "e1-2", source: "1", target: "2" }],
    }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["flow", "flowchart", "react flow", "decision", "process", "algorithm"],
  };
  registerBlock(def);
}
