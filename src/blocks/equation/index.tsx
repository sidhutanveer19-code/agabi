"use client";

import { z } from "zod";
import katex from "katex";
import "katex/dist/katex.min.css";
import { color } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({ tex: z.string(), display: z.boolean().default(true) });
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  const html = katex.renderToString(data.tex, {
    displayMode: data.display,
    throwOnError: false,
  });
  return (
    <div
      className="ds-scroll"
      style={{ color: color.inkBright, fontSize: 20, overflowX: "auto", padding: "6px 2px" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const equationBlock = defineBlock<Data>({
  type: "equation",
  label: "Equation",
  category: "math",
  defaultSize: { w: 520, h: 80 },
  schema,
  Renderer,
  sample: { tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", display: true },
});
