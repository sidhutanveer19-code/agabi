"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Atom } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { PhysicsData } from "@/features/workspace/blocks/physics/Renderer";

// Heavy library (matter-js) — code-split, loaded only when a physics block mounts.
const PhysicsRenderer = dynamic(() => import("@/features/workspace/blocks/physics/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="physics…" />,
});

const schema = z.object({
  preset: z.enum(["gravity", "pendulum", "stack"]),
}) as z.ZodType<PhysicsData>;

function PhysicsBlock(props: BlockRendererProps<PhysicsData>) {
  return <PhysicsRenderer {...props} />;
}

export function registerPhysicsBlock(): void {
  if (hasBlock("physics")) return;
  const def: BlockDefinition<PhysicsData> = {
    type: "physics",
    label: "Physics Sim",
    category: "diagram",
    icon: Atom,
    version: 1,
    component: PhysicsBlock,
    schema,
    create: () => ({ preset: "gravity" }),
    defaultSize: { w: 480, h: 360 },
    interactive: true,
    resizable: true,
    keywords: ["physics", "matter", "simulation", "gravity", "pendulum", "stack", "2d", "mechanics"],
  };
  registerBlock(def);
}
