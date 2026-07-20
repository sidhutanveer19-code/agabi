"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { LineChart } from "lucide-react";
import { color } from "@/config/tokens";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { GraphData } from "@/features/workspace/blocks/graph/Renderer";

// Heavy library (jsxgraph) — code-split, loaded only when a graph block mounts.
const GraphRenderer = dynamic(() => import("@/features/workspace/blocks/graph/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="graph…" />,
});

const schema = z.object({
  functions: z.array(z.object({ expr: z.string(), color: z.string().optional() })),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
}) as z.ZodType<GraphData>;

function GraphBlock(props: BlockRendererProps<GraphData>) {
  return <GraphRenderer {...props} />;
}

export function registerGraphBlock(): void {
  if (hasBlock("graph")) return;
  const def: BlockDefinition<GraphData> = {
    type: "graph",
    label: "Function Graph",
    category: "math",
    icon: LineChart,
    version: 1,
    component: GraphBlock,
    schema,
    create: () => ({
      functions: [
        { expr: "sin(x)", color: color.cyan },
        { expr: "x^2 * 0.2 - 2", color: color.violet2 },
      ],
      bounds: [-6, -4, 6, 4],
    }),
    defaultSize: { w: 480, h: 360 },
    interactive: true,
    resizable: true,
    keywords: ["graph", "function", "plot", "cartesian", "curve", "jsxgraph", "math", "chart"],
  };
  registerBlock(def);
}
