"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Code2 } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MonacoData } from "@/features/workspace/blocks/monaco/Renderer";

// Heavy library — code-split, loaded only when a monaco block mounts.
const MonacoRenderer = dynamic(() => import("@/features/workspace/blocks/monaco/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="editor…" />,
});

const schema = z.object({ code: z.string(), language: z.string() }) as z.ZodType<MonacoData>;

function MonacoBlock(props: BlockRendererProps<MonacoData>) {
  return <MonacoRenderer {...props} />;
}

export function registerMonacoBlock(): void {
  if (hasBlock("monaco")) return;
  const def: BlockDefinition<MonacoData> = {
    type: "monaco",
    label: "Code",
    category: "data",
    icon: Code2,
    version: 1,
    component: MonacoBlock,
    schema,
    create: () => ({
      code: "function greet(name) {\n  return `Hello, ${name}!`;\n}\n\ngreet(\"world\");\n",
      language: "javascript",
    }),
    defaultSize: { w: 480, h: 320 },
    interactive: true,
    resizable: true,
    keywords: ["code", "editor", "monaco", "javascript", "snippet", "program", "syntax"],
  };
  registerBlock(def);
}
