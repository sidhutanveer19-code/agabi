"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Box } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { ThreedData } from "@/features/workspace/blocks/threed/Renderer";

// Heavy library (three + r3f + drei) — code-split, loaded only when a 3D block mounts.
const Renderer = dynamic(() => import("@/features/workspace/blocks/threed/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="3D scene…" />,
});

const shapeSchema = z.object({
  type: z.enum(["box", "sphere", "cylinder", "cone", "torus"]),
  args: z.array(z.number()).optional(),
  color: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
});

const schema = z.object({ shapes: z.array(shapeSchema) }) as z.ZodType<ThreedData>;

function ThreedBlock(props: BlockRendererProps<ThreedData>) {
  return <Renderer {...props} />;
}

export function registerThreedBlock(): void {
  if (hasBlock("threed")) return;
  const def: BlockDefinition<ThreedData> = {
    type: "threed",
    label: "3D Scene",
    category: "diagram",
    icon: Box,
    version: 1,
    component: ThreedBlock,
    schema,
    create: () => ({
      shapes: [
        { type: "sphere", position: [-0.9, 0, 0], color: "#a78bfa" },
        { type: "box", position: [0.9, 0, 0], color: "#7dd3fc" },
      ],
    }),
    defaultSize: { w: 480, h: 360 },
    interactive: true,
    resizable: true,
    keywords: ["3d", "three", "react three fiber", "scene", "shape", "geometry", "orbit"],
  };
  registerBlock(def);
}
