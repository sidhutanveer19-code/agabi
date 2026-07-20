"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Globe } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { EmbedData } from "@/features/workspace/blocks/embed/Renderer";

// Sandboxed <iframe> renderer — code-split, loaded only when an embed block mounts.
const EmbedRenderer = dynamic(() => import("@/features/workspace/blocks/embed/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="embed…" />,
});

const schema = z.object({
  url: z.string(),
  title: z.string(),
}) as z.ZodType<EmbedData>;

function EmbedBlock(props: BlockRendererProps<EmbedData>) {
  return <EmbedRenderer {...props} />;
}

export function registerEmbedBlock(): void {
  if (hasBlock("embed")) return;
  const def: BlockDefinition<EmbedData> = {
    type: "embed",
    label: "Embed",
    category: "media",
    icon: Globe,
    version: 1,
    component: EmbedBlock,
    schema,
    create: () => ({ url: "", title: "" }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["embed", "iframe", "widget", "external", "site", "webpage", "media"],
  };
  registerBlock(def);
}
