"use client";

import { useMemo } from "react";
import { color, font } from "@/design-system/tokens";
import {
  registerAllBlocks,
  allBlocks,
  BlockRenderer,
  type BlockInstance,
} from "@/workspace/blocks";

export default function GalleryPage() {
  const blocks = useMemo(() => {
    registerAllBlocks();
    return allBlocks();
  }, []);

  return (
    <div
      className="ds-scroll"
      style={{
        height: "100vh",
        overflow: "auto",
        background: color.bg,
        color: color.ink,
        padding: "40px 32px 120px",
      }}
    >
      <h1 style={{ fontFamily: font.display, fontSize: 34, color: color.inkBright, margin: 0 }}>
        Block Gallery
      </h1>
      <p style={{ color: color.muted, marginTop: 6, marginBottom: 34, fontFamily: font.sans }}>
        {blocks.length} registered blocks, each rendered with sample data via the block registry.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 30, maxWidth: 1120 }}>
        {blocks.map((def) => {
          const instance: BlockInstance = {
            id: def.type,
            type: def.type,
            layout: { x: 0, y: 0, w: def.defaultSize.w, h: def.defaultSize.h },
            data: def.sample,
          };
          return (
            <section key={def.type}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: color.muted,
                  marginBottom: 10,
                }}
              >
                {def.label} · {def.category}
              </div>
              <div style={{ maxWidth: def.defaultSize.w }}>
                <BlockRenderer block={instance} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
