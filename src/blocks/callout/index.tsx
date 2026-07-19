"use client";

import { z } from "zod";
import { color, font, radius } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  tone: z.enum(["info", "idea", "success", "warn"]).default("info"),
  title: z.string().optional(),
  body: z.string(),
});
type Data = z.infer<typeof schema>;

const TONE: Record<Data["tone"], { accent: string; bg: string }> = {
  info: { accent: color.cyan, bg: "rgba(56,189,248,.07)" },
  idea: { accent: color.violet2, bg: "rgba(167,139,250,.08)" },
  success: { accent: color.green, bg: "rgba(111,207,151,.08)" },
  warn: { accent: color.orange, bg: "rgba(232,148,78,.08)" },
};

function Renderer({ data }: BlockRendererProps<Data>) {
  const t = TONE[data.tone];
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        borderRadius: radius.lg,
        border: `1px solid ${t.accent}44`,
        background: t.bg,
        fontFamily: font.sans,
      }}
    >
      <div style={{ width: 4, borderRadius: 2, background: t.accent, flex: "none" }} />
      <div>
        {data.title && (
          <div style={{ fontSize: 14, fontWeight: 600, color: t.accent, marginBottom: 4 }}>
            {data.title}
          </div>
        )}
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: color.inkSoft }}>{data.body}</div>
      </div>
    </div>
  );
}

export const calloutBlock = defineBlock<Data>({
  type: "callout",
  label: "Callout",
  category: "pedagogy",
  defaultSize: { w: 520, h: 100 },
  schema,
  Renderer,
  sample: {
    tone: "idea",
    title: "Key insight",
    body: "Plants are the only organisms that build food from light — everything else eats that stored sunlight.",
  },
});
