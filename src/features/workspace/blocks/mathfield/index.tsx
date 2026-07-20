"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Sigma } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MathfieldData } from "@/features/workspace/blocks/mathfield/Renderer";

// Heavy library (MathLive) — code-split, loaded only when a mathfield block mounts.
const Renderer = dynamic(() => import("@/features/workspace/blocks/mathfield/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="equation…" />,
});

const schema = z.object({ latex: z.string() }) as z.ZodType<MathfieldData>;

function MathfieldBlock(props: BlockRendererProps<MathfieldData>) {
  return <Renderer {...props} />;
}

export function registerMathfieldBlock(): void {
  if (hasBlock("mathfield")) return;
  const def: BlockDefinition<MathfieldData> = {
    type: "mathfield",
    label: "Math Field",
    category: "math",
    icon: Sigma,
    version: 1,
    component: MathfieldBlock,
    schema,
    create: () => ({ latex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}" }),
    defaultSize: { w: 360, h: 120 },
    interactive: true,
    resizable: true,
    keywords: ["math", "equation", "formula", "latex", "mathlive", "algebra", "mathfield"],
  };
  registerBlock(def);
}
