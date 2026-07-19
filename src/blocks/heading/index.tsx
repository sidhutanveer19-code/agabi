"use client";

import { z } from "zod";
import { color, font, typeScale } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  text: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  accent: z.string().optional(),
});
type Data = z.infer<typeof schema>;

const SIZES = { 1: typeScale.h1.size, 2: typeScale.h2.size, 3: typeScale.h3.size } as const;

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <div
      style={{
        margin: 0,
        fontFamily: font.display,
        fontSize: SIZES[data.level],
        lineHeight: 1.15,
        letterSpacing: "-.012em",
        color: data.accent ?? color.inkBright,
      }}
    >
      {data.text}
    </div>
  );
}

export const headingBlock = defineBlock<Data>({
  type: "heading",
  label: "Heading",
  category: "structure",
  defaultSize: { w: 680, h: 60 },
  schema,
  Renderer,
  sample: { text: "Understanding photosynthesis", level: 1 },
});
