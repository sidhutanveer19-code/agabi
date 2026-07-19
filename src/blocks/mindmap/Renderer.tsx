"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { color, font } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { MindmapData } from "./schema";

const transformer = new Transformer();

export function Renderer({ data }: BlockRendererProps<MindmapData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const { root } = transformer.transform(data.markdown);
    if (!mmRef.current) {
      mmRef.current = Markmap.create(
        svgRef.current,
        { paddingX: 16, duration: 300, color: () => color.violet2 },
        root
      );
    } else {
      void mmRef.current.setData(root);
    }
    void mmRef.current.fit();
  }, [data.markdown]);

  useEffect(
    () => () => {
      mmRef.current?.destroy?.();
      mmRef.current = null;
    },
    []
  );

  return (
    <svg
      ref={svgRef}
      style={{ width: "100%", height: 300, color: color.inkSoft, fontFamily: font.sans }}
    />
  );
}
