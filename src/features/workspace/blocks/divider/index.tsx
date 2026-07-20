"use client";

import { z } from "zod";
import { Minus } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { color } from "@/config/tokens";

export interface DividerData {
  variant: "solid" | "dashed" | "dotted";
}

const schema = z.object({ variant: z.enum(["solid", "dashed", "dotted"]) }) as z.ZodType<DividerData>;

function DividerBlock({ block }: BlockRendererProps<DividerData>) {
  const variant = block.data?.variant ?? "solid";
  return (
    <div role="separator" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", padding: "0 4px" }}>
      <div style={{ width: "100%", borderTop: `1px ${variant} ${color.borderStrong}` }} />
    </div>
  );
}

export function registerDividerBlock(): void {
  if (hasBlock("divider")) return;
  const def: BlockDefinition<DividerData> = {
    type: "divider",
    label: "Divider",
    category: "structure",
    icon: Minus,
    version: 1,
    component: DividerBlock,
    schema,
    create: () => ({ variant: "solid" }),
    defaultSize: { w: 460, h: 24 },
    interactive: true,
    resizable: true,
    keywords: ["divider", "hr", "rule", "separator"],
  };
  registerBlock(def);
}
