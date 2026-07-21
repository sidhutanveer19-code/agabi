"use client";

import { z } from "zod";
import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";
import { color, font, radius } from "@/config/tokens";

export interface ImageData {
  src: string;
  alt: string;
  caption: string;
}

const schema = z.object({ src: z.string(), alt: z.string(), caption: z.string() }) as z.ZodType<ImageData>;

function ImageBlock({ block, editing, onChange }: BlockRendererProps<ImageData>) {
  const data = block.data ?? { src: "", alt: "", caption: "" };
  const [broken, setBroken] = useState(false);
  const imgSrc = safeUrl(data.src, "image"); // untrusted (AI-streamed) URL guard

  return (
    <figure style={{ width: "100%", height: "100%", margin: 0, display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: radius.md, background: color.surface, border: `1px solid ${color.border}`, overflow: "hidden", minHeight: 60 }}>
        {imgSrc && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote/data URLs on an infinite canvas; next/image needs known domains
          <img
            src={imgSrc}
            alt={data.alt}
            loading="lazy"
            onError={() => setBroken(true)}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: color.muted, fontFamily: font.mono, fontSize: 11 }}>
            <ImageIcon size={20} />
            {broken ? "image failed to load" : "no image"}
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <input value={data.src} onChange={(e) => { setBroken(false); onChange?.({ ...data, src: e.target.value }); }} placeholder="Image URL…" style={inputStyle} />
          <input value={data.alt} onChange={(e) => onChange?.({ ...data, alt: e.target.value })} placeholder="Alt text (accessibility)…" style={inputStyle} />
          <input value={data.caption} onChange={(e) => onChange?.({ ...data, caption: e.target.value })} placeholder="Caption…" style={inputStyle} />
        </div>
      ) : (
        data.caption && (
          <figcaption style={{ textAlign: "center", color: color.muted, fontFamily: font.sans, fontSize: 12.5 }}>{data.caption}</figcaption>
        )
      )}
    </figure>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  color: color.inkSoft,
  fontFamily: font.sans,
  fontSize: 13,
  padding: "6px 8px",
  outline: "none",
};

export function registerImageBlock(): void {
  if (hasBlock("image")) return;
  const def: BlockDefinition<ImageData> = {
    type: "image",
    label: "Image",
    category: "media",
    icon: ImageIcon,
    version: 1,
    component: ImageBlock,
    schema,
    create: () => ({ src: "", alt: "", caption: "" }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["image", "picture", "photo", "figure"],
  };
  registerBlock(def);
}
