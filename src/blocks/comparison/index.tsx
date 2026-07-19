"use client";

import { z } from "zod";
import { color, font } from "@/design-system/tokens";
import { BlockCard } from "@/workspace/blocks/BlockCard";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const column = z.object({ head: z.string(), points: z.array(z.string()) });
const schema = z.object({
  title: z.string().optional(),
  left: column,
  right: column,
});
type Data = z.infer<typeof schema>;

function Col({ head, points, accent }: { head: string; points: string[]; accent: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: accent, marginBottom: 10 }}>{head}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
        {points.map((p, i) => (
          <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: color.inkDim }}>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Renderer({ data }: BlockRendererProps<Data>) {
  return (
    <BlockCard eyebrow={data.title ?? "Comparison"} accent={color.violet2}>
      <div style={{ display: "flex", gap: 22, fontFamily: font.sans }}>
        <Col head={data.left.head} points={data.left.points} accent={color.cyan2} />
        <div style={{ width: 1, background: color.border }} />
        <Col head={data.right.head} points={data.right.points} accent={color.orange} />
      </div>
    </BlockCard>
  );
}

export const comparisonBlock = defineBlock<Data>({
  type: "comparison",
  label: "Comparison",
  category: "pedagogy",
  defaultSize: { w: 620, h: 200 },
  schema,
  Renderer,
  sample: {
    title: "Photosynthesis vs Respiration",
    left: { head: "Photosynthesis", points: ["Uses sunlight", "Takes in CO₂", "Releases O₂", "Stores energy"] },
    right: { head: "Respiration", points: ["No light needed", "Takes in O₂", "Releases CO₂", "Releases energy"] },
  },
});
