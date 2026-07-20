"use client";

import { z } from "zod";
import type { JSONContent } from "@tiptap/core";
import { Megaphone, Lightbulb, AlertTriangle, FileText, BookOpen, Sparkles } from "lucide-react";
import type { BlockDefinition, BlockRendererProps, BlockIcon } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { RichText } from "@/features/workspace/blocks/shared/RichText";
import { font } from "@/config/tokens";

export interface AdmonitionData {
  doc: JSONContent;
}

const schema = z.object({ doc: z.any() }) as unknown as z.ZodType<AdmonitionData>;
const emptyDoc = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph" }] });

interface AdmonPreset {
  type: string;
  label: string;
  icon: BlockIcon;
  accent: string;
  tint: string;
}

const PRESETS: AdmonPreset[] = [
  { type: "callout", label: "Callout", icon: Megaphone, accent: "#a78bfa", tint: "rgba(167,139,250,0.09)" },
  { type: "tip", label: "Tip", icon: Lightbulb, accent: "#6fcf97", tint: "rgba(111,207,151,0.09)" },
  { type: "warning", label: "Warning", icon: AlertTriangle, accent: "#e8944e", tint: "rgba(232,148,78,0.10)" },
  { type: "summary", label: "Summary", icon: FileText, accent: "#38bdf8", tint: "rgba(56,189,248,0.09)" },
  { type: "definition", label: "Definition", icon: BookOpen, accent: "#c4b5fd", tint: "rgba(196,181,253,0.09)" },
  { type: "example", label: "Example", icon: Sparkles, accent: "#d9c36b", tint: "rgba(217,195,107,0.09)" },
];

const BY_TYPE = new Map(PRESETS.map((p) => [p.type, p]));

function Admonition({ block, editing, onChange }: BlockRendererProps<AdmonitionData>) {
  const p = BY_TYPE.get(block.type) ?? PRESETS[0];
  const Icon = p.icon;
  return (
    <div
      role="note"
      aria-label={p.label}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${p.accent}44`,
        borderLeft: `3px solid ${p.accent}`,
        background: p.tint,
        overflow: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: p.accent }}>
        <Icon size={15} />
        <span style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}>
          {p.label}
        </span>
      </div>
      <RichText value={block.data?.doc ?? null} editing={editing} onChange={(next) => onChange?.({ doc: next })} />
    </div>
  );
}

export function registerAdmonitionBlocks(): void {
  for (const p of PRESETS) {
    if (hasBlock(p.type)) continue;
    const def: BlockDefinition<AdmonitionData> = {
      type: p.type,
      label: p.label,
      category: "text",
      icon: p.icon,
      version: 1,
      component: Admonition,
      schema,
      create: () => ({ doc: emptyDoc() }),
      defaultSize: { w: 480, h: 130 },
      interactive: true,
      resizable: true,
      keywords: [p.label.toLowerCase(), "admonition", "box"],
    };
    registerBlock(def);
  }
}
