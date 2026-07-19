"use client";

import { z } from "zod";
import ReactMarkdown from "react-markdown";
import { color, font } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({ content: z.string() });
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <div
      className="ds-prose"
      style={{ fontFamily: font.sans, fontSize: 15, lineHeight: 1.7, color: color.inkDim }}
    >
      <ReactMarkdown>{data.content}</ReactMarkdown>
    </div>
  );
}

export const markdownBlock = defineBlock<Data>({
  type: "markdown",
  label: "Rich text",
  category: "text",
  defaultSize: { w: 600, h: 200 },
  schema,
  Renderer,
  sample: {
    content:
      "## Key points\n\n- **Chlorophyll** captures light energy\n- Water is split into hydrogen and oxygen\n- The Calvin cycle builds glucose\n\nThis is the foundation of every food chain.",
  },
});
