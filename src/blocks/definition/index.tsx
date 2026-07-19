"use client";

import { z } from "zod";
import { color, font } from "@/design-system/tokens";
import { BlockCard } from "@/workspace/blocks/BlockCard";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({ term: z.string(), definition: z.string() });
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <BlockCard eyebrow="Definition" accent={color.gold}>
      <div style={{ fontFamily: font.display, fontSize: 22, color: color.inkBright, marginBottom: 6 }}>
        {data.term}
      </div>
      <div style={{ fontFamily: font.sans, fontSize: 15, lineHeight: 1.65, color: color.inkDim }}>
        {data.definition}
      </div>
    </BlockCard>
  );
}

export const definitionBlock = defineBlock<Data>({
  type: "definition",
  label: "Definition",
  category: "pedagogy",
  defaultSize: { w: 480, h: 130 },
  schema,
  Renderer,
  sample: {
    term: "Photosynthesis",
    definition: "The process by which green plants convert light energy into chemical energy stored as glucose.",
  },
});
