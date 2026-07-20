"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { FileText } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { DocumentData } from "@/features/workspace/blocks/document/Renderer";

// Heavy library (react-pdf + pdf.js) — code-split, loaded only when a document block mounts.
const DocumentRenderer = dynamic(() => import("@/features/workspace/blocks/document/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="document…" />,
});

const schema = z.object({ url: z.string() }) as z.ZodType<DocumentData>;

function DocumentBlock(props: BlockRendererProps<DocumentData>) {
  return <DocumentRenderer {...props} />;
}

export function registerDocumentBlock(): void {
  if (hasBlock("document")) return;
  const def: BlockDefinition<DocumentData> = {
    type: "document",
    label: "Document",
    category: "media",
    icon: FileText,
    version: 1,
    component: DocumentBlock,
    schema,
    create: () => ({ url: "" }),
    defaultSize: { w: 480, h: 620 },
    interactive: true,
    resizable: true,
    keywords: ["document", "pdf", "react-pdf", "viewer", "file", "paper"],
  };
  registerBlock(def);
}
