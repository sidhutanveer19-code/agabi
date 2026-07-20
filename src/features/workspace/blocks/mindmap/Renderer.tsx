"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
// NOTE: markmap-view/markmap-lib ship NO css file — the library injects its own
// global CSS at runtime (embedGlobalCSS). There is nothing to import here; we
// theme colors through Markmap options + a scoped <style> below instead.
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";

export interface MindmapData {
  markdown: string;
}

/** Depth-cycled accent palette so branches read as distinct in the dark theme. */
const BRANCH_COLORS = [color.violet2, color.cyan, color.green, color.gold, color.orange, color.violet3] as const;

/**
 * Mind map renderer (lazy-loaded). Renders a markmap from a markdown outline.
 * Present mode = pan/zoom-only exploration; editing (dev) exposes a markdown
 * textarea whose changes persist into the block's `data` via onChange.
 */
export default function MindmapRenderer({ block, editing, onChange }: BlockRendererProps<MindmapData>) {
  const data = block.data ?? { markdown: "" };
  const markdown = data.markdown;

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const { root } = new Transformer().transform(markdown);
    const mm = Markmap.create(
      svg,
      {
        autoFit: true,
        duration: 240,
        embedGlobalCSS: true,
        paddingX: 16,
        color: (node) => BRANCH_COLORS[node.state.depth % BRANCH_COLORS.length],
        style: (id) =>
          `${id} a{color:${color.cyan2}} ` +
          `${id} div{color:${color.ink};font-family:${font.sans}} ` +
          `${id} .markmap-foreign{color:${color.ink}}`,
      },
      root,
    );

    return () => {
      mm.destroy();
      svg.innerHTML = "";
    };
  }, [markdown]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <svg
        ref={svgRef}
        role="img"
        aria-label="Mind map"
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {editing ? (
        <textarea
          value={markdown}
          spellCheck={false}
          aria-label="Mind map markdown outline"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange?.({ ...data, markdown: e.target.value })}
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            width: "42%",
            minWidth: 200,
            height: "44%",
            resize: "none",
            padding: 10,
            borderRadius: radius.md,
            border: `1px solid ${color.borderStrong}`,
            background: "rgba(6,7,12,0.82)",
            color: color.inkSoft,
            fontFamily: font.mono,
            fontSize: 12,
            lineHeight: 1.5,
            outline: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,.35)",
          }}
        />
      ) : null}
    </div>
  );
}
