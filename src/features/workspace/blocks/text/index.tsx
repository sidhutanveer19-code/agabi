"use client";

import { z } from "zod";
import { color, font, radius } from "@/config/tokens";
import type { BlockRendererProps, BlockDefinition } from "../registry";

/**
 * The one foundational content block for Phase 2 — a read-only text card. It
 * exists so regions have real content to render/verify. Educational blocks
 * (equation, chart, …) are Phase 3/4 and register the same way.
 */
export const textBlockSchema = z.object({ text: z.string() });
export type TextBlockData = z.infer<typeof textBlockSchema>;

function TextRenderer({ data }: BlockRendererProps<TextBlockData>) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.surface,
        color: color.inkDim,
        fontFamily: font.sans,
        fontSize: 15,
        lineHeight: 1.6,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {data.text}
    </div>
  );
}

export const textBlock: BlockDefinition<TextBlockData> = {
  type: "text",
  label: "Text",
  Renderer: TextRenderer,
};
