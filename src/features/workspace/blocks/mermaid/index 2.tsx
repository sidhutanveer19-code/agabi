"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Network } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MermaidData } from "@/features/workspace/blocks/mermaid/MermaidRenderer";

const MermaidRenderer = dynamic(() => import("@/features/workspace/blocks/mermaid/MermaidRenderer"), {
  ssr: false,
  loading: () => <BlockLoading label="diagram…" />,
});

const schema = z.object({ source: z.string() }) as z.ZodType<MermaidData>;

function MermaidBlock(props: BlockRendererProps<MermaidData>) {
  return <MermaidRenderer {...props} />;
}

export function registerMermaidBlock(): void {
  if (hasBlock("mermaid")) return;
  const def: BlockDefinition<MermaidData> = {
    type: "mermaid",
    label: "Mermaid Diagram",
    category: "diagram",
    icon: Network,
    version: 1,
    component: MermaidBlock,
    schema,
    create: () => ({ source: "graph TD;\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do this]\n  B -->|No| D[Do that]" }),
    defaultSize: { w: 460, h: 320 },
    interactive: true,
    resizable: true,
    keywords: ["mermaid", "diagram", "sequence", "state", "class", "er", "flow"],
  };
  registerBlock(def);
}
