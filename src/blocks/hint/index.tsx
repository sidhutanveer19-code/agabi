"use client";

import { z } from "zod";
import { color, font, radius } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  prompt: z.string().default("Show hint"),
  body: z.string(),
});
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <details
      style={{
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        background: color.surface,
        padding: "12px 16px",
        fontFamily: font.sans,
      }}
    >
      <summary style={{ cursor: "pointer", color: color.violet2, fontSize: 14, userSelect: "none" }}>
        {data.prompt}
      </summary>
      <div style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: color.inkDim }}>
        {data.body}
      </div>
    </details>
  );
}

export const hintBlock = defineBlock<Data>({
  type: "hint",
  label: "Hint",
  category: "pedagogy",
  defaultSize: { w: 460, h: 56 },
  schema,
  Renderer,
  sample: { prompt: "Stuck? Reveal a hint", body: "Think about what the plant takes IN versus what it gives OUT." },
});
