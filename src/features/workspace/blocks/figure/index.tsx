"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Tags } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { FigureData } from "@/features/workspace/blocks/figure/Renderer";

// Heavy renderer — code-split, loaded only when a figure block mounts.
const FigureRenderer = dynamic(() => import("@/features/workspace/blocks/figure/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="figure…" />,
});

const schema = z.object({
  src: z.string(),
  alt: z.string(),
  labels: z.array(
    z.object({ id: z.string(), x: z.number(), y: z.number(), text: z.string() }),
  ),
}) as z.ZodType<FigureData>;

function FigureBlock(props: BlockRendererProps<FigureData>) {
  return <FigureRenderer {...props} />;
}

export function registerFigureBlock(): void {
  if (hasBlock("figure")) return;
  const def: BlockDefinition<FigureData> = {
    type: "figure",
    label: "Labeled Figure",
    category: "media",
    icon: Tags,
    version: 1,
    component: FigureBlock,
    schema,
    create: () => ({
      src: "",
      alt: "",
      labels: [
        { id: "sample-1", x: 0.32, y: 0.34, text: "Nucleus" },
        { id: "sample-2", x: 0.62, y: 0.6, text: "Membrane" },
      ],
    }),
    defaultSize: { w: 480, h: 380 },
    interactive: true,
    resizable: true,
    keywords: ["figure", "label", "diagram", "anatomy", "biology", "cell", "annotate", "callout", "image"],
  };
  registerBlock(def);
}
