"use client";

import { z } from "zod";
import { color, font } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({ content: z.string() });
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: font.sans,
        fontSize: 16,
        lineHeight: 1.7,
        color: color.inkDim,
      }}
    >
      {data.content}
    </p>
  );
}

export const textBlock = defineBlock<Data>({
  type: "text",
  label: "Paragraph",
  category: "text",
  defaultSize: { w: 560, h: 90 },
  schema,
  Renderer,
  sample: {
    content:
      "Photosynthesis is how plants turn sunlight, water, and carbon dioxide into the sugar they use to grow — releasing the oxygen we breathe along the way.",
  },
});
