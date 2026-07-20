"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { BarChart3 } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { ChartData } from "@/features/workspace/blocks/chart/Renderer";

// Heavy library (recharts) — code-split, loaded only when a chart block mounts.
const Renderer = dynamic(() => import("@/features/workspace/blocks/chart/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="chart…" />,
});

const schema = z.object({
  kind: z.enum(["bar", "line", "area", "pie", "scatter"]),
  series: z.array(z.object({ key: z.string(), color: z.string().optional() })),
  data: z.array(z.record(z.string(), z.union([z.number(), z.string()]))),
  xKey: z.string(),
}) as z.ZodType<ChartData>;

function ChartBlock(props: BlockRendererProps<ChartData>) {
  return <Renderer {...props} />;
}

export function registerChartBlock(): void {
  if (hasBlock("chart")) return;
  const def: BlockDefinition<ChartData> = {
    type: "chart",
    label: "Chart",
    category: "data",
    icon: BarChart3,
    version: 1,
    component: ChartBlock,
    schema,
    create: (): ChartData => ({
      kind: "bar",
      xKey: "label",
      series: [{ key: "value" }],
      data: [
        { label: "A", value: 8 },
        { label: "B", value: 14 },
        { label: "C", value: 6 },
        { label: "D", value: 11 },
      ],
    }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["chart", "graph", "bar", "line", "area", "pie", "scatter", "recharts", "data", "plot"],
  };
  registerBlock(def);
}
