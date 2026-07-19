"use client";

import { z } from "zod";
import { color, font } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({ label: z.string().optional() });
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  const line = "linear-gradient(90deg,transparent,rgba(167,139,250,.4),transparent)";
  if (!data.label) {
    return <div style={{ height: 1, width: "100%", background: line }} />;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1, height: 1, background: line }} />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: color.muted,
        }}
      >
        {data.label}
      </span>
      <div style={{ flex: 1, height: 1, background: line }} />
    </div>
  );
}

export const dividerBlock = defineBlock<Data>({
  type: "divider",
  label: "Divider",
  category: "structure",
  defaultSize: { w: 560, h: 20 },
  schema,
  Renderer,
  sample: { label: "Next section" },
});
