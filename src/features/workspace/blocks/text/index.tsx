"use client";

import { z } from "zod";
import type { CSSProperties } from "react";
import type { JSONContent } from "@tiptap/core";
import { Type, Pilcrow, Heading1, Heading2, Quote, StickyNote, Captions } from "lucide-react";
import type { BlockDefinition, BlockRendererProps, BlockIcon } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { RichText } from "@/features/workspace/blocks/shared/RichText";
import { color } from "@/config/tokens";

/** Every text-based block stores a ProseMirror document. */
export interface TextData {
  doc: JSONContent;
}

const textDataSchema = z.object({ doc: z.any() }) as unknown as z.ZodType<TextData>;

/** A ProseMirror doc from a list of nodes. */
const doc = (...nodes: JSONContent[]): JSONContent => ({ type: "doc", content: nodes });
const para = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined,
});
const heading = (level: number, text = ""): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: text ? [{ type: "text", text }] : undefined,
});

interface TextPreset {
  type: string;
  label: string;
  icon: BlockIcon;
  keywords: string[];
  content: () => JSONContent;
  wrapperStyle?: CSSProperties;
  defaultSize: { w: number; h: number };
}

const PRESETS: TextPreset[] = [
  { type: "paragraph", label: "Paragraph", icon: Pilcrow, keywords: ["text", "body", "p"], content: () => doc(para("")), defaultSize: { w: 560, h: 110 } },
  { type: "richtext", label: "Rich Text", icon: Type, keywords: ["rich", "format", "text"], content: () => doc(para("")), defaultSize: { w: 560, h: 150 } },
  { type: "heading", label: "Heading", icon: Heading1, keywords: ["title", "h1"], content: () => doc(heading(1, "")), defaultSize: { w: 560, h: 72 } },
  { type: "subheading", label: "Subheading", icon: Heading2, keywords: ["h2", "section"], content: () => doc(heading(2, "")), defaultSize: { w: 560, h: 60 } },
  {
    type: "quote",
    label: "Quote",
    icon: Quote,
    keywords: ["blockquote", "cite"],
    content: () => doc({ type: "blockquote", content: [para("")] }),
    defaultSize: { w: 560, h: 96 },
  },
  {
    type: "notes",
    label: "Note",
    icon: StickyNote,
    keywords: ["note", "sticky", "aside"],
    content: () => doc(para("")),
    wrapperStyle: {
      background: "rgba(217,195,107,0.06)",
      border: `1px solid rgba(217,195,107,0.28)`,
      borderRadius: 12,
      padding: 14,
    },
    defaultSize: { w: 460, h: 120 },
  },
  {
    type: "caption",
    label: "Caption",
    icon: Captions,
    keywords: ["label", "figure"],
    content: () => doc(para("")),
    wrapperStyle: { textAlign: "center", color: color.muted, fontSize: 12.5 },
    defaultSize: { w: 460, h: 44 },
  },
];

const PRESET_BY_TYPE = new Map(PRESETS.map((p) => [p.type, p]));

function TextBlock({ block, editing, onChange }: BlockRendererProps<TextData>) {
  const preset = PRESET_BY_TYPE.get(block.type);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: preset?.wrapperStyle ? 0 : 4,
        overflow: "auto",
        ...preset?.wrapperStyle,
      }}
    >
      <RichText
        value={block.data?.doc ?? null}
        editing={editing}
        onChange={(next) => onChange?.({ doc: next })}
      />
    </div>
  );
}

/** Register every text preset. */
export function registerTextBlocks(): void {
  for (const p of PRESETS) {
    if (hasBlock(p.type)) continue;
    const def: BlockDefinition<TextData> = {
      type: p.type,
      label: p.label,
      category: "text",
      icon: p.icon,
      version: 1,
      component: TextBlock,
      schema: textDataSchema,
      create: () => ({ doc: p.content() }),
      defaultSize: p.defaultSize,
      interactive: true,
      resizable: true,
      keywords: p.keywords,
    };
    registerBlock(def);
  }
}
