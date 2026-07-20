"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Triangle } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { GeometryData } from "@/features/workspace/blocks/geometry/Renderer";

// Heavy library (jsxgraph) — code-split, loaded only when a geometry block mounts.
const GeometryRenderer = dynamic(() => import("@/features/workspace/blocks/geometry/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="geometry…" />,
});

const schema = z.object({
  points: z.array(
    z.object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      name: z.string().optional(),
    }),
  ),
  segments: z.array(z.tuple([z.string(), z.string()])),
}) as z.ZodType<GeometryData>;

function GeometryBlock(props: BlockRendererProps<GeometryData>) {
  return <GeometryRenderer {...props} />;
}

export function registerGeometryBlock(): void {
  if (hasBlock("geometry")) return;
  const def: BlockDefinition<GeometryData> = {
    type: "geometry",
    label: "Geometry",
    category: "math",
    icon: Triangle,
    version: 1,
    component: GeometryBlock,
    schema,
    create: () => ({
      points: [
        { id: "A", x: -2, y: -1, name: "A" },
        { id: "B", x: 2, y: -1, name: "B" },
        { id: "C", x: 0, y: 2.5, name: "C" },
      ],
      segments: [
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
      ],
    }),
    defaultSize: { w: 420, h: 420 },
    interactive: true,
    resizable: true,
    keywords: ["geometry", "jsxgraph", "triangle", "point", "segment", "shape", "construction", "math"],
  };
  registerBlock(def);
}
